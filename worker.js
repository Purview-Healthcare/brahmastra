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

const VERSION = "2.102.0";
// A session outlives 24 hours without activity: it lasts 25 hours and is pushed back on use once less than 24 are left.
const SESSION_MS = 25 * 60 * 60 * 1000, SESSION_KEEP_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PEPPER = "brahmastra-change-this-pepper";
const DEFAULT_BOOTSTRAP_EMAIL = "supervisor@purview-healthcare.com";
const DEFAULT_BOOTSTRAP_PASSWORD = "brahmastra-setup";
const WORKABLE = "('open','assigned','in_progress','completed')";
/* Inventory status's stages as claims.list filters (claims c): an open hand-off wins, then the state, then the follow-up date. */
const INV_HO = (st) => `EXISTS (SELECT 1 FROM handoffs hx WHERE hx.claim_id = c.id AND hx.status IN (${st}))`;
const INV_NO_OPEN_HO = `NOT ${INV_HO("'pending','assigned','client'")}`;
const INV_STAGE_SQL = Object.assign(Object.create(null), {
  waiting: `(c.state IN ${WORKABLE} OR c.state = 'in_process') AND ${INV_HO("'client'")}`,
  desk: `(c.state IN ${WORKABLE} OR c.state = 'in_process') AND NOT ${INV_HO("'client'")} AND ${INV_HO("'pending','assigned'")}`,
  open: `c.state = 'open' AND ${INV_NO_OPEN_HO}`,
  list: `c.state IN ('assigned','in_progress') AND ${INV_NO_OPEN_HO}`,
  overdue: `c.state = 'completed' AND ${INV_NO_OPEN_HO} AND COALESCE(c.follow_up_on, '') <> '' AND c.follow_up_on < ?`,
  due: `c.state = 'completed' AND ${INV_NO_OPEN_HO} AND c.follow_up_on = ?`,
  later: `c.state = 'completed' AND ${INV_NO_OPEN_HO} AND NOT (COALESCE(c.follow_up_on, '') <> '' AND c.follow_up_on < ?) AND COALESCE(c.follow_up_on, '') <> ?`,
});
// An escalation waits for the team lead wherever the claim is: on a list, at a desk (in process), or closed by that same save.
const ESCALATION_STATES = "('open','assigned','in_progress','completed','in_process','closed')";

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
  `CREATE TABLE IF NOT EXISTS handoffs (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, client_id TEXT NOT NULL, dept TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL, created_by TEXT, created_by_name TEXT NOT NULL DEFAULT '', saag_action TEXT NOT NULL DEFAULT '', due_at INTEGER NOT NULL,
     lead_id TEXT, backup_id TEXT, assigned_to TEXT, assigned_at INTEGER, done_at INTEGER, done_by TEXT, done_by_name TEXT NOT NULL DEFAULT '',
     proof_json TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs (status, dept, due_at)`,
  `CREATE INDEX IF NOT EXISTS idx_handoffs_claim ON handoffs (claim_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS detail_uploads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT, user_id TEXT, user_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
     file_name TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', overwrite INTEGER NOT NULL DEFAULT 0, rows_read INTEGER NOT NULL DEFAULT 0,
     rows_matched INTEGER NOT NULL DEFAULT 0, claims_updated INTEGER NOT NULL DEFAULT 0, fields_json TEXT NOT NULL DEFAULT '{}', unmatched_json TEXT NOT NULL DEFAULT '[]')`,
  `CREATE TABLE IF NOT EXISTS payer_limits (client_id TEXT NOT NULL, payer_key TEXT NOT NULL, payer TEXT NOT NULL DEFAULT '', tfl_days INTEGER, afl_days INTEGER,
     note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, updated_by TEXT, updated_by_name TEXT NOT NULL DEFAULT '', PRIMARY KEY (client_id, payer_key))`,
  `CREATE TABLE IF NOT EXISTS availability (client_id TEXT NOT NULL, day TEXT NOT NULL, on_json TEXT NOT NULL DEFAULT '[]', by_user TEXT, at INTEGER NOT NULL, PRIMARY KEY (client_id, day))`,
  `CREATE TABLE IF NOT EXISTS client_access (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'view',
     granted_by TEXT, granted_by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, UNIQUE (client_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT, user_name TEXT NOT NULL DEFAULT '', user_email TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT 'bug', message TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '', context_json TEXT NOT NULL DEFAULT '{}', files_json TEXT NOT NULL DEFAULT '[]',
     emailed_to TEXT NOT NULL DEFAULT '', email_error TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', done_by_name TEXT NOT NULL DEFAULT '', done_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS feedback_files (id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT, user_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
     client_id TEXT, detail TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at)`,
  `CREATE TABLE IF NOT EXISTS user_notices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, view TEXT NOT NULL DEFAULT 'clients', client_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS digest_runs (week TEXT NOT NULL, client_id TEXT NOT NULL, at INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, by_name TEXT NOT NULL DEFAULT '', PRIMARY KEY (week, client_id))`,
  `CREATE TABLE IF NOT EXISTS tat_holds (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, client_id TEXT NOT NULL, claim_id TEXT, since INTEGER, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', until TEXT NOT NULL, by_id TEXT, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, cleared_at INTEGER, cleared_by_name TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_tat_holds_ref ON tat_holds (kind, ref_id, cleared_at)`,
  // Team tasks: a team lead's task for people on their team, each person's share, every update, and the files (data in attachment_parts)
  `CREATE TABLE IF NOT EXISTS team_tasks (id TEXT PRIMARY KEY, client_id TEXT, scope TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
     tat_hours REAL NOT NULL DEFAULT 24, due_at INTEGER NOT NULL, count_total INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'open', closed_at INTEGER, closed_by_name TEXT NOT NULL DEFAULT '', hold_reason TEXT NOT NULL DEFAULT '', hold_note TEXT NOT NULL DEFAULT '', hold_until TEXT,
     hold_by_name TEXT NOT NULL DEFAULT '', lead_seen_at INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks (status, due_at)`,
  `CREATE TABLE IF NOT EXISTS team_task_people (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL, share INTEGER NOT NULL DEFAULT 0, done_n INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'new', updated_at INTEGER, completed_at INTEGER, seen_at INTEGER, reminded_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_team_task_people_user ON team_task_people (user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_team_task_people_task ON team_task_people (task_id)`,
  `CREATE TABLE IF NOT EXISTS team_task_updates (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, person_id TEXT, user_id TEXT, user_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
     done_n INTEGER, delta INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_team_task_updates_task ON team_task_updates (task_id, at)`,
  `CREATE INDEX IF NOT EXISTS idx_team_task_updates_user ON team_task_updates (user_id, at)`,
  `CREATE TABLE IF NOT EXISTS team_task_files (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, update_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
     parts INTEGER NOT NULL DEFAULT 0, user_id TEXT, user_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_team_task_files_task ON team_task_files (task_id)`,
  `CREATE TABLE IF NOT EXISTS tat_mail_log (day TEXT NOT NULL, kind TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', items INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, user_id))`,
  `CREATE TABLE IF NOT EXISTS digest_log (week TEXT NOT NULL, client_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, ok INTEGER NOT NULL DEFAULT 1, error TEXT NOT NULL DEFAULT '', PRIMARY KEY (week, client_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS attendance (user_id TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'out', reason TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (user_id, day))`,
  `CREATE TABLE IF NOT EXISTS team_notes (user_id TEXT PRIMARY KEY, start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS inv_snapshots (client_id TEXT NOT NULL, day TEXT NOT NULL, cells_json TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL, PRIMARY KEY (client_id, day))`,
  `CREATE TABLE IF NOT EXISTS creport_edits (client_id TEXT NOT NULL, period_key TEXT NOT NULL, loc TEXT NOT NULL DEFAULT '', page_id TEXT NOT NULL, json TEXT NOT NULL DEFAULT '{}',
     by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (client_id, period_key, loc, page_id))`,
  `CREATE TABLE IF NOT EXISTS ev_rows (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT NOT NULL DEFAULT '', batch_id TEXT NOT NULL, work_date TEXT NOT NULL,
     dos TEXT NOT NULL DEFAULT '', acct TEXT NOT NULL DEFAULT '', payer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', done_by TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_ev_rows_client ON ev_rows (client_id, work_date)`,
  `CREATE INDEX IF NOT EXISTS idx_ev_rows_batch ON ev_rows (batch_id)`,
  `CREATE TABLE IF NOT EXISTS shastra_alerts (user_id TEXT NOT NULL, day TEXT NOT NULL, by_id TEXT NOT NULL, state TEXT NOT NULL, until_at INTEGER, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL,
     PRIMARY KEY (user_id, day, by_id))`,
  `CREATE TABLE IF NOT EXISTS ev_batches (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', from_day TEXT NOT NULL,
     to_day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS floor_days (user_id TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', tof_min INTEGER, idle_min INTEGER, locked_min INTEGER,
     logged_min INTEGER, break_min INTEGER, open INTEGER NOT NULL DEFAULT 0, guard INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`,
  `CREATE TABLE IF NOT EXISTS coach_notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'one_to_one', text TEXT NOT NULL DEFAULT '', by_id TEXT, by_name TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_coach_user ON coach_notes (user_id, at)`,
  `CREATE TABLE IF NOT EXISTS note_templates (id TEXT PRIMARY KEY, client_id TEXT, title TEXT NOT NULL, text TEXT NOT NULL, by_id TEXT, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS client_snapshots (client_id TEXT NOT NULL, day TEXT NOT NULL, ar_balance REAL NOT NULL DEFAULT 0, ar_claims INTEGER NOT NULL DEFAULT 0,
     over90_balance REAL NOT NULL DEFAULT 0, over90_claims INTEGER NOT NULL DEFAULT 0, over120_balance REAL NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (client_id, day))`,
  `CREATE TABLE IF NOT EXISTS client_log (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'note', text TEXT NOT NULL DEFAULT '',
     next_on TEXT NOT NULL DEFAULT '', by_id TEXT, by_name TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_client_log ON client_log (client_id, at)`,
  `CREATE TABLE IF NOT EXISTS client_monthend (client_id TEXT NOT NULL, month TEXT NOT NULL, step TEXT NOT NULL, done_at INTEGER, done_by_name TEXT NOT NULL DEFAULT '',
     auto INTEGER NOT NULL DEFAULT 0, score REAL, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (client_id, month, step))`,
  `CREATE TABLE IF NOT EXISTS raci (client_id TEXT PRIMARY KEY, r_json TEXT NOT NULL DEFAULT '[]', a_json TEXT NOT NULL DEFAULT '[]', c_json TEXT NOT NULL DEFAULT '[]',
     i_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER, updated_by TEXT, updated_by_name TEXT NOT NULL DEFAULT '')`,
  /* Escalation tracker: client escalations logged by SMEs and above, one register per client (SR1, SR2...), copied to the
     client's OneDrive file "Escalation Tracker - <Client>.xlsx" on every change. */
  `CREATE TABLE IF NOT EXISTS escalations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, sr INTEGER NOT NULL, day TEXT NOT NULL, dept TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'Medium',
     raised_src TEXT NOT NULL DEFAULT 'Client', raised_who TEXT NOT NULL DEFAULT '', how TEXT NOT NULL DEFAULT '', claim_no TEXT NOT NULL DEFAULT '', owner_id TEXT, owner_name TEXT NOT NULL DEFAULT '',
     description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', rca TEXT NOT NULL DEFAULT '', resolved_at INTEGER,
     delay_reason TEXT NOT NULL DEFAULT '', expected_on TEXT NOT NULL DEFAULT '', delay_by_name TEXT NOT NULL DEFAULT '', delay_at INTEGER, reason_asked_at INTEGER,
     created_at INTEGER NOT NULL, created_by TEXT, created_by_name TEXT NOT NULL DEFAULT '', updated_at INTEGER, updated_by_name TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_escalations ON escalations (client_id, sr)`,
];

/* Columns added after the first release. ensureReady() adds any that an
   existing database is missing, so upgrades need no manual migration. */
const EXTRA_COLUMNS = {
  // kind 'alloc': "N new claims were allocated to you"; seen_at once the biller has closed the banner
  user_notices: [["kind", "TEXT NOT NULL DEFAULT ''"], ["seen_at", "INTEGER"]],
  notes: [["status", "TEXT NOT NULL DEFAULT ''"], ["sub_status", "TEXT NOT NULL DEFAULT ''"], ["action", "TEXT NOT NULL DEFAULT ''"], ["bucket", "TEXT NOT NULL DEFAULT ''"],
    ["effective", "TEXT NOT NULL DEFAULT ''"], ["note_action", "TEXT NOT NULL DEFAULT ''"], ["fields_json", "TEXT NOT NULL DEFAULT '{}'"], ["edited_at", "INTEGER"], ["edited_by", "TEXT"],
    // Minutes on the phone for this entry (from the call start / end times), for the dashboard's call time.
    ["call_min", "INTEGER"]],
  claims: [["last_sub_status", "TEXT NOT NULL DEFAULT ''"], ["last_bucket", "TEXT NOT NULL DEFAULT ''"], ["last_effective", "TEXT NOT NULL DEFAULT ''"], ["last_note_action", "TEXT NOT NULL DEFAULT ''"],
    ["alt_key", "TEXT NOT NULL DEFAULT ''"], ["fp_key", "TEXT NOT NULL DEFAULT ''"],
    // Escalations: when the biller flagged it, and when / by whom a team lead answered.
    ["escalated_at", "INTEGER"], ["escalated_by", "TEXT"], ["escalation_answered_at", "INTEGER"], ["escalation_answered_by", "TEXT"],
    // when the claim was closed (set by a trigger from the save that closed it; a later note does not move it)
    ["closed_at", "INTEGER"],
    // with_posting | posted | with_submission | submitted | posting_assist | submission_assist
    ["handoff_status", "TEXT NOT NULL DEFAULT ''"],
    // Priority set by a team lead (top | high | low; '' = automatic), the automatic score underneath, and why.
    ["priority_set", "TEXT NOT NULL DEFAULT ''"], ["priority_base", "REAL"], ["priority_set_label", "TEXT NOT NULL DEFAULT ''"], ["priority_set_by", "TEXT"], ["priority_set_at", "INTEGER"],
    // Filled from a patient details report when the inventory file does not carry them.
    // Date of the denial / EOB, from the biller's note: the appeal filing limit (AFL) counts from it.
    ["denial_date", "TEXT NOT NULL DEFAULT ''"],
    ["patient_dob", "TEXT NOT NULL DEFAULT ''"], ["member_id", "TEXT NOT NULL DEFAULT ''"], ["patient_phone", "TEXT NOT NULL DEFAULT ''"],
    // First on the biller's list until they save an entry: sent back by a department, or given to them by the supervisor after a review.
    ["first_up", "INTEGER NOT NULL DEFAULT 0"], ["reviewed_at", "INTEGER"], ["reviewed_by_name", "TEXT NOT NULL DEFAULT ''"]],
  // The supervisors' escalation format: who it was reported to at Purview, the email subject, whether it was a Purview error,
  // a comment, corrective and preventive action (with the root cause in rca) and the close date.
  escalations: [["reported_to", "TEXT NOT NULL DEFAULT ''"], ["email_subject", "TEXT NOT NULL DEFAULT ''"], ["is_error", "TEXT NOT NULL DEFAULT ''"], ["comment", "TEXT NOT NULL DEFAULT ''"],
    ["corrective", "TEXT NOT NULL DEFAULT ''"], ["preventive", "TEXT NOT NULL DEFAULT ''"], ["close_on", "TEXT NOT NULL DEFAULT ''"],
    ["kind", "TEXT NOT NULL DEFAULT 'external'"], ["error_by_id", "TEXT"], ["error_by_name", "TEXT NOT NULL DEFAULT ''"], ["error_dow", "TEXT NOT NULL DEFAULT ''"],
    ["location_id", "TEXT"], ["location_name", "TEXT NOT NULL DEFAULT ''"], ["channels", "TEXT NOT NULL DEFAULT ''"], ["review_on", "TEXT NOT NULL DEFAULT ''"], ["rework", "TEXT NOT NULL DEFAULT ''"]],
  locations: [["team_json", "TEXT NOT NULL DEFAULT '[]'"], ["auto_allocate", "INTEGER NOT NULL DEFAULT 1"], ["workbook_link", "TEXT NOT NULL DEFAULT ''"]],
  // the money owed (positive balances, credits left out) and its over-90 part, for the over-90 share on the trend; empty on readings kept before
  client_snapshots: [["ar_owed", "REAL"], ["over90_owed", "REAL"]],
  clients: [["team_json", "TEXT NOT NULL DEFAULT '[]'"], ["auto_allocate", "INTEGER NOT NULL DEFAULT 1"], ["workbook_link", "TEXT NOT NULL DEFAULT ''"],
    ["roster_names_json", "TEXT NOT NULL DEFAULT '[]'"], ["caps_json", "TEXT NOT NULL DEFAULT '{}'"],
    // Who does payment posting / submission for this client: a person (with a backup), the client itself, or the biller.
    ["posting_mode", "TEXT NOT NULL DEFAULT ''"], ["posting_lead", "TEXT"], ["posting_backup", "TEXT"],
    ["submission_mode", "TEXT NOT NULL DEFAULT ''"], ["submission_lead", "TEXT"], ["submission_backup", "TEXT"],
    // Who checks a submitted claim for acceptance / rejection 24 working hours after it was submitted.
    ["submission_check_mode", "TEXT NOT NULL DEFAULT ''"], ["submission_check_person", "TEXT"],
    // Rejections: the person who checks and fixes rejected claims first (their top priority), with a backup.
    ["rejection_mode", "TEXT NOT NULL DEFAULT ''"], ["rejection_lead", "TEXT"], ["rejection_backup", "TEXT"],
    // The client profile: the scope of work Purview does (ar, posting, submission, rejection), a daily target for each,
    // and the AR person responsible (with a backup). Required for a new client; older clients show what is missing.
    ["scope_json", "TEXT NOT NULL DEFAULT '[]'"], ["targets_json", "TEXT NOT NULL DEFAULT '{}'"],
    // The client's own folders in the Purviewautomate OneDrive: Brahmastra Clients / <Client> / Inventory, Production.
    ["od_drive_id", "TEXT"], ["od_folder_id", "TEXT"], ["od_inventory_id", "TEXT"], ["od_production_id", "TEXT"],
    ["od_link", "TEXT NOT NULL DEFAULT ''"], ["od_inventory_link", "TEXT NOT NULL DEFAULT ''"], ["od_production_link", "TEXT NOT NULL DEFAULT ''"], ["od_status_json", "TEXT NOT NULL DEFAULT '{}'"], ["od_prod_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["ar_mode", "TEXT NOT NULL DEFAULT ''"], ["ar_lead", "TEXT"], ["ar_backup", "TEXT"],
    // The client's logo for the client report (a small image as a data URL; never sent with the client list).
    ["logo", "TEXT NOT NULL DEFAULT ''"],
    // Payment posting and Submission TAT for this client, in working hours (set on the client profile; 24 when not set).
    ["posting_tat_hours", "INTEGER"], ["submission_tat_hours", "INTEGER"], ["subcheck_hours", "INTEGER"]],
  batches: [["source", "TEXT NOT NULL DEFAULT 'file'"], ["web_url", "TEXT NOT NULL DEFAULT ''"]],
  users: [["failed_logins", "INTEGER NOT NULL DEFAULT 0"], ["locked_at", "INTEGER"], ["prefs_json", "TEXT NOT NULL DEFAULT '{}'"], ["doj", "TEXT NOT NULL DEFAULT ''"], ["first_name", "TEXT NOT NULL DEFAULT ''"], ["last_name", "TEXT NOT NULL DEFAULT ''"], ["designation", "TEXT NOT NULL DEFAULT ''"],
    // From the Purview Shastra roster (source = 'roster'); people added by hand keep source = 'manual'.
    ["source", "TEXT NOT NULL DEFAULT 'manual'"], ["emp_id", "TEXT NOT NULL DEFAULT ''"], ["position", "TEXT NOT NULL DEFAULT ''"], ["roster_kind", "TEXT NOT NULL DEFAULT ''"],
    ["department", "TEXT NOT NULL DEFAULT ''"], ["departments_also", "TEXT NOT NULL DEFAULT ''"], ["roster_status", "TEXT NOT NULL DEFAULT ''"], ["exit_date", "TEXT NOT NULL DEFAULT ''"],
    ["reports_to", "TEXT"], ["reports_to_name", "TEXT NOT NULL DEFAULT ''"], ["projects_json", "TEXT NOT NULL DEFAULT '[]'"], ["scope_projects_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["access_all", "INTEGER NOT NULL DEFAULT 0"], ["email_missing", "INTEGER NOT NULL DEFAULT 0"], ["shift", "TEXT NOT NULL DEFAULT ''"], ["city", "TEXT NOT NULL DEFAULT ''"],
    // Where the email came from: 0 Purview Shastra (or an account made by hand), 1 typed in Brahmastra by the person or a team lead
    // where Shastra had none, 2 set by the admin. A typed one signs the person in here but never picks their Drishti account.
    ["email_typed", "INTEGER NOT NULL DEFAULT 0"]],
  sessions: [["via", "TEXT NOT NULL DEFAULT 'password'"]],
  handoffs: [["available_at", "INTEGER"], ["paused_at", "INTEGER"], ["client_answered_at", "INTEGER"],
    // Need client assistance: who asked, the AR team lead who sent it to the client (how, when, comment), and when to chase the client.
    ["client_req_by_name", "TEXT NOT NULL DEFAULT ''"], ["client_sent_at", "INTEGER"], ["client_sent_by", "TEXT"], ["client_sent_by_name", "TEXT NOT NULL DEFAULT ''"],
    ["client_sent_how", "TEXT NOT NULL DEFAULT ''"], ["client_sent_note", "TEXT NOT NULL DEFAULT ''"], ["chase_at", "INTEGER"],
    // Pending: the department's latest comment on where an open hand-off stands.
    ["pending_at", "INTEGER"], ["pending_by_name", "TEXT NOT NULL DEFAULT ''"],
    // The biller who worked the claim (they see the recheck after a resubmission and can mark it), the department a recheck
    // comes from, and the desk's state while open: in_process | pending | other.
    ["biller_id", "TEXT"], ["from_dept", "TEXT NOT NULL DEFAULT ''"], ["desk_state", "TEXT NOT NULL DEFAULT ''"]],
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
/* Every call to an outside server (Shastra, Drishti, Graph, email) gives up after a while, so a slow server cannot hold up a page or the scheduled job. */
const FETCH_TIMEOUT_MS = 20000;
const fetchT = (url, init = {}, ms = FETCH_TIMEOUT_MS) => fetch(url, { ...init, ...(!init.signal && globalThis.AbortSignal && globalThis.AbortSignal.timeout ? { signal: globalThis.AbortSignal.timeout(ms) } : {}) });
function splitFrom(from) { const m = String(from || "").match(/^\s*(.*?)\s*<([^>]+)>\s*$/); return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { name: "Brahmastra", email: String(from || "").trim() }; }
async function sendEmail(env, { to, subject, text, html, attachments }) {
  const att = Array.isArray(attachments) ? attachments : [];
  const provider = String(env.EMAIL_PROVIDER || "").toLowerCase().trim();
  if (!provider) throw new ApiError(503, "Email is not set up on the server yet (EMAIL_PROVIDER). A team lead can give you a sign-in code from the Team screen instead.");
  const from = splitFrom(env.EMAIL_FROM || "Brahmastra <no-reply@purview-healthcare.com>");
  const fail = async (r, who) => { let t = ""; try { t = (await r.text()).slice(0, 300); } catch {} throw new ApiError(502, `${who} did not accept the email (${r.status}${t ? ": " + t : ""}).`); };
  if (provider === "resend") {
    const r = await fetchT("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.EMAIL_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, text, html, ...(att.length ? { attachments: att.map((a) => ({ filename: a.name, content: a.b64 })) } : {}) }) });
    if (!r.ok) await fail(r, "Resend");
  } else if (provider === "brevo") {
    const r = await fetchT("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.EMAIL_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { name: from.name, email: from.email }, to: [{ email: to }], subject, textContent: text, htmlContent: html, ...(att.length ? { attachment: att.map((a) => ({ name: a.name, content: a.b64 })) } : {}) }) });
    if (!r.ok) await fail(r, "Brevo");
  } else if (provider === "sendgrid") {
    const r = await fetchT("https://api.sendgrid.com/v3/mail/send", { method: "POST", headers: { Authorization: "Bearer " + env.EMAIL_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from.email, name: from.name }, subject, content: [{ type: "text/plain", value: text }, { type: "text/html", value: html }], ...(att.length ? { attachments: att.map((a) => ({ content: a.b64, filename: a.name, type: a.type, disposition: "attachment" })) } : {}) }) });
    if (!r.ok) await fail(r, "SendGrid");
  } else if (provider === "graph") {
    const tr = await fetchT(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID || "")}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.MS_CLIENT_ID || "", client_secret: env.MS_CLIENT_SECRET || "", scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
    if (!tr.ok) await fail(tr, "Microsoft sign-in (token)");
    const tok = (await tr.json()).access_token;
    const sender = env.MS_SENDER || from.email;
    const r = await fetchT(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }],
        ...(att.length ? { attachments: att.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.type, contentBytes: a.b64 })) } : {}) }, saveToSentItems: false }) });
    if (!r.ok) await fail(r, "Microsoft Graph");
  } else if (provider === "webhook") {
    const r = await fetchT(env.EMAIL_WEBHOOK_URL || "", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: env.EMAIL_API_KEY || "", to, subject, text, html, ...(att.length ? { attachments: att } : {}) }) });
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
// the first and last millisecond of an IST day given as YYYY-MM-DD
const istDayStart = (iso) => Date.parse(iso + "T00:00:00Z") - IST_MIN * 60000, istDayEnd = (iso) => istDayStart(iso) + 86400000 - 1;
const mdy = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
/* Week ending Saturday; the range starts on the Sunday before. A week that crosses a month is split at the month end:
   a day in the earlier month ends its range (and week) on that month's last day, a day in the later month starts on the 1st. */
function weekOf(ms) {
  const d = istDate(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const we = new Date(day); we.setUTCDate(we.getUTCDate() + ((6 - we.getUTCDay()) % 7));
  const start = new Date(we); start.setUTCDate(start.getUTCDate() - 6);
  let from = start, to = we;
  if (start.getUTCMonth() !== we.getUTCMonth()) {
    if (day.getUTCMonth() === we.getUTCMonth()) from = new Date(Date.UTC(we.getUTCFullYear(), we.getUTCMonth(), 1));
    else to = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
  }
  const iso = (x) => x.toISOString().slice(0, 10);
  return { range: mdy(iso(from)) + " - " + mdy(iso(to)), week: "WE-" + mdy(iso(to)) };
}
function productionRow(c, by, extra) {
  const now = (extra && extra.ended_at) || Date.now();
  // Start / End Time and Total Duration are the call's, as the biller entered them; empty when the work was not a call.
  const f = (extra && extra.fields) || {};
  const mins = callMinutes(f.call_start, f.call_end);
  const wk = weekOf(now);
  const dosSerial = excelSerial(c.dos);
  const dosISO = String(c.dos || "").slice(0, 10);
  // an entry's age is on the day it was worked; the Claims tab's list (age_at) is aged to today, as the screen shows
  const ageDay = istISO((extra && extra.age_at) || now);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(dosISO) ? Math.max(0, Math.round((Date.parse(ageDay + "T00:00:00Z") - Date.parse(dosISO + "T00:00:00Z")) / 86400000)) : c.age_days;
  return [SR_NO, (by && by.city) || "", c.client_name || "", c.location_name || "",
    [c.patient, dosSerial, c.payer, c.cpt].map((x) => (x == null ? "" : x)).join(""), c.claim_no || "", c.patient || "", dosSerial === "" ? (c.dos || "") : dosSerial, c.payer || "",
    age == null ? "" : age, ageBucketLetter(age), c.billed == null ? "" : Number(c.billed), Number(c.balance) || 0, c.cpt || "",
    c.last_note || "", c.last_status_code || "", c.last_sub_status || "", c.last_action_code || "", c.last_bucket || "", f.source || "",
    f.call_start || "", f.call_end || "", mins == null ? "" : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`, excelSerial(istISO(now)),
    (by && by.emp_id) || "", (by && by.name) || "", "Production", "", (by && by.reports_to_name) || "", wk.range, wk.week];
}
function workbookLinkOf(v) { if (v == null) return null; const s = str(v, 1000).trim(); if (!s) return ""; if (!/^https:\/\//i.test(s)) throw bad("Paste the whole OneDrive link, starting with https://"); return s; }
async function graphAppToken(env) {
  if (!env.MS_TENANT_ID || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) throw new ApiError(503, "Microsoft 365 is not set up on the server (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).");
  const tr = await fetchT(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
  if (!tr.ok) throw new ApiError(502, "Microsoft sign-in (token) did not accept (" + tr.status + ").");
  return (await tr.json()).access_token;
}
async function graphCall(tok, method, path, body) {
  const r = await fetchT("https://graph.microsoft.com/v1.0" + path, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
  if (!r.ok) { let t = ""; try { t = (await r.text()).slice(0, 240); } catch {} throw new ApiError(502, `Microsoft Graph ${method} ${path.split("?")[0].slice(0, 80)} failed (${r.status}${t ? ": " + t : ""})`); }
  if (r.status === 204) return null;
  return r.json();
}
const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/* Every write of cell values into an Excel workbook through Microsoft Graph goes through writeRange. Graph reads a value the
   way Excel reads typing, so text that starts with = + - @ (or a tab or a carriage return) would become a formula: a comment
   "-ve balance" shows #NAME?, a typed =HYPERLINK(...) becomes a live link in the team's file. Such text gets a leading
   apostrophe, which Excel keeps as a hidden text marker (the cell shows the text as typed). Numbers stay numbers, negative
   amounts too, and so does text that is only a number. The same rule as csvSafe in app.jsx for the CSV downloads. */
const xlText = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? "'" + v : v);
const writeRange = (tok, path, values, numberFormat) => graphCall(tok, "PATCH", path, { values: values.map((row) => row.map(xlText)), ...(numberFormat ? { numberFormat } : {}) });
async function appendRowTo(tok, loc, values, header = WORKBOOK_HEADER) {
  const base = `/drives/${encodeURIComponent(loc.driveId)}/items/${encodeURIComponent(loc.itemId)}/workbook`;
  const sheets = await graphCall(tok, "GET", base + "/worksheets?$top=1&$select=id,name");
  const sheet = sheets.value && sheets.value[0]; if (!sheet) throw new ApiError(400, "The workbook has no worksheet.");
  const ws = base + "/worksheets/" + encodeURIComponent(sheet.id);
  const used = await graphCall(tok, "GET", ws + "/usedRange(valuesOnly=true)?$select=rowCount,address,values");
  const empty = !used || used.rowCount <= 1 && (!used.values || !used.values[0] || used.values[0].every((v) => v === "" || v == null));
  let rows = empty ? [header, values] : [values];
  const startRow = empty ? 1 : (parseInt(String(used.address).replace(/^.*![A-Z]+\d+:?[A-Z]*/, "").replace(/\D/g, ""), 10) || used.rowCount) + 1;
  // Sr. No = the row's own number in the sheet (header is row 1).
  const srOf = (sheetRow) => sheetRow - 1;
  rows = rows.map((r, i) => r.map((v) => (v === SR_NO ? srOf(startRow + i) : v)));
  const last = colLetter(header.length);
  // DOS and Date Worked are Excel dates shown as mm/dd/yyyy and the amounts as money (as the desks' files do), so the file reads
  // the same whatever OneDrive's language; the header row stays as it is. Text goes in as text, never as a formula (writeRange).
  const fmt = header === WORKBOOK_HEADER ? AR_FMT : null;
  await writeRange(tok, ws + `/range(address='A${startRow}:${last}${startRow + rows.length - 1}')`, rows, fmt ? rows.map((r, i) => (empty && i === 0 ? header.map(() => "General") : fmt)) : null);
  return loc.name;
}
/* ---- the team's report files in OneDrive ----
   Every lead's clients keep their files in one place, in the Purviewautomate OneDrive (REPORTS_OWNER):
     Brahmastra Reports / <Team lead> / <Client> / Production | QA tracker | Quality insights | SLA & KPI
   Brahmastra writes Production itself: one workbook per client per month, "Production - <Client> - Oct 2026.xlsx",
   one row per saved entry in the Production Conso layout. A client or location with its own workbook link keeps
   using that link instead. Needs the Files.ReadWrite.All application permission on the Microsoft 365 app. */
const REPORTS_ROOT = "Brahmastra Reports";
const REPORTS_OWNER_DEFAULT = "Purviewautomate@purview-healthcare.com";
const PROD_TEMPLATE_B64 = "UEsDBBQAAAAIANOIXV1Gx01IlQAAAM0AAAAQAAAAZG9jUHJvcHMvYXBwLnhtbE3PTQvCMAwG4L9SdreZih6kDkQ9ip68zy51hbYpbYT67+0EP255ecgboi6JIia2mEXxLuRtMzLHDUDWI/o+y8qhiqHke64x3YGMsRoPpB8eA8OibdeAhTEMOMzit7Dp1C5GZ3XPlkJ3sjpRJsPiWDQ6sScfq9wcChDneiU+ixNLOZcrBf+LU8sVU57mym/8ZAW/B7oXUEsDBBQAAAAIANOIXV3XyS6E7wAAACsCAAARAAAAZG9jUHJvcHMvY29yZS54bWzNkttKxDAQhl9Fct9OD1DZ0O2N4pWC4ILiXUhmd4PNgWSk3bc3jbtdRB/Ay8z8+eYbmF56Ll3A5+A8BtIYb2Yz2sil37IjkecAUR7RiFimhE3NvQtGUHqGA3ghP8QBoamqDgySUIIELMDCr0Q29EpyGVCQC2e8kivef4Yxw5QEHNGgpQh1WQMblon+NI89XAELjDCY+F1AtRJz9U9s7gA7J+eo19Q0TeXU5lzaoYa3p8eXvG6hbSRhJaZfUXM6edyyy+TX9u5+98CGpmq6oq6KZrOrb3nV8Xbzvrj+8LsKG6f0Xv9j44vg0MOvuxi+AFBLAwQUAAAACADTiF1dmVycIxAGAACcJwAAEwAAAHhsL3RoZW1lL3RoZW1lMS54bWztWltz2jgUfu+v0Hhn9m0LxjaBtrQTc2l227SZhO1OH4URWI1seWSRhH+/RzYQy5YN7ZJNups8BCzp+85FR+foOHnz7i5i6IaIlPJ4YNkv29a7ty/e4FcyJBFBMBmnr/DACqVMXrVaaQDDOH3JExLD3IKLCEt4FMvWXOBbGi8j1uq0291WhGlsoRhHZGB9XixoQNBUUVpvXyC05R8z+BXLVI1lowETV0EmuYi08vlsxfza3j5lz+k6HTKBbjAbWCB/zm+n5E5aiOFUwsTAamc/VmvH0dJIgILJfZQFukn2o9MVCDINOzqdWM52fPbE7Z+Mytp0NG0a4OPxeDi2y9KLcBwE4FG7nsKd9Gy/pEEJtKNp0GTY9tqukaaqjVNP0/d93+ubaJwKjVtP02t33dOOicat0HgNvvFPh8Ouicar0HTraSYn/a5rpOkWaEJG4+t6EhW15UDTIABYcHbWzNIDll4p+nWUGtkdu91BXPBY7jmJEf7GxQTWadIZljRGcp2QBQ4AN8TRTFB8r0G2iuDCktJckNbPKbVQGgiayIH1R4Ihxdyv/fWXu8mkM3qdfTrOa5R/aasBp+27m8+T/HPo5J+nk9dNQs5wvCwJ8fsjW2GHJ247E3I6HGdCfM/29pGlJTLP7/kK6048Zx9WlrBdz8/knoxyI7vd9lh99k9HbiPXqcCzIteURiRFn8gtuuQROLVJDTITPwidhphqUBwCpAkxlqGG+LTGrBHgE323vgjI342I96tvmj1XoVhJ2oT4EEYa4pxz5nPRbPsHpUbR9lW83KOXWBUBlxjfNKo1LMXWeJXA8a2cPB0TEs2UCwZBhpckJhKpOX5NSBP+K6Xa/pzTQPCULyT6SpGPabMjp3QmzegzGsFGrxt1h2jSPHr+BfmcNQockRsdAmcbs0YhhGm78B6vJI6arcIRK0I+Yhk2GnK1FoG2camEYFoSxtF4TtK0EfxZrDWTPmDI7M2Rdc7WkQ4Rkl43Qj5izouQEb8ehjhKmu2icVgE/Z5ew0nB6ILLZv24fobVM2wsjvdH1BdK5A8mpz/pMjQHo5pZCb2EVmqfqoc0PqgeMgoF8bkePuV6eAo3lsa8UK6CewH/0do3wqv4gsA5fy59z6XvufQ9odK3NyN9Z8HTi1veRm5bxPuuMdrXNC4oY1dyzcjHVK+TKdg5n8Ds/Wg+nvHt+tkkhK+aWS0jFpBLgbNBJLj8i8rwKsQJ6GRbJQnLVNNlN4oSnkIbbulT9UqV1+WvuSi4PFvk6a+hdD4sz/k8X+e0zQszQ7dyS+q2lL61JjhK9LHMcE4eyww7ZzySHbZ3oB01+/ZdduQjpTBTl0O4GkK+A226ndw6OJ6YkbkK01KQb8P56cV4GuI52QS5fZhXbefY0dH758FRsKPvPJYdx4jyoiHuoYaYz8NDh3l7X5hnlcZQNBRtbKwkLEa3YLjX8SwU4GRgLaAHg69RAvJSVWAxW8YDK5CifEyMRehw55dcX+PRkuPbpmW1bq8pdxltIlI5wmmYE2eryt5lscFVHc9VW/Kwvmo9tBVOz/5ZrcifDBFOFgsSSGOUF6ZKovMZU77nK0nEVTi/RTO2EpcYvOPmx3FOU7gSdrYPAjK5uzmpemUxZ6by3y0MCSxbiFkS4k1d7dXnm5yueiJ2+pd3wWDy/XDJRw/lO+df9F1Drn723eP6bpM7SEycecURAXRFAiOVHAYWFzLkUO6SkAYTAc2UyUTwAoJkphyAmPoLvfIMuSkVzq0+OX9FLIOGTl7SJRIUirAMBSEXcuPv75Nqd4zX+iyBbYRUMmTVF8pDicE9M3JD2FQl867aJguF2+JUzbsaviZgS8N6bp0tJ//bXtQ9tBc9RvOjmeAes4dzm3q4wkWs/1jWHvky3zlw2zreA17mEyxDpH7BfYqKgBGrYr66r0/5JZw7tHvxgSCb/NbbpPbd4Ax81KtapWQrET9LB3wfkgZjjFv0NF+PFGKtprGtxtoxDHmAWPMMoWY434dFmhoz1YusOY0Kb0HVQOU/29QNaPYNNByRBV4xmbY2o+ROCjzc/u8NsMLEjuHti78BUEsDBBQAAAAIANOIXV0KCG+osAMAAJwPAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1snZddc9soFED/CqPdh/YlsnC+2rE949hpm90k9cZOs+0bka5tNgi0CK2b/fULkvBkZBCefUksiXO5cARXjHZCvpRbAIV+5oyX42irVPExjst0CzkpT0QBXD9ZC5kTpS/lJi4LCSSroZzFeDA4j3NCeTQZ1fcWcjISlWKUw0KisspzIl+vgIndOEoie+OBbrbK3Igno4JsYAnqsVhIfRXvo2Q0B15SwZGE9TiaJh+n1zVQt/hGYVe++Y3MUJ6FeDEXN9k4GkQmNAf0uiwYrTtDShS3sFYzYEwHxBEiqaL/wEI3G0fPQimRm+c6TUWUvrWW4l/gdZ/AQLfVyRQHjZsgbVAzxr/bhKP9eExSb3/bzD/VE6sn6pmUMBPsiWZqO44uI5TBmlRMPYjdF2gn68zESwUr679o17S9iFBalTqZltUJ5JQ3/8nPdo7ftE+wB8AtgLvApQcYtsCwC5x7gNMWOO0AeOABzlrg7NiUzlvgvNuDb9AXLXDR7SHxAJctcHlsSh9a4EMH8E1SMrDiBt0uTn3I3vXRshNrOznQ7UWs7+RAuBexxpOu8jOf8sQ6Tw6ke4dvrSdHa0+s96QrHnt7seaTA/XesVj3SVe+fxFa+/jAvq8XbO3jA/teZL/Wj7aPrX18tH1s7eOufX9i1j7u2vfuEdjax137/sSsfdy171vE2MrHR697bOXjrnzvKza08odHL/2hlT9sqk1THuraMieKTEZS7JCs25saMtzP4r6q6DKZmhZ15Wqq5Dii3BTwpZL6KdUB1WQpT9C9GMVKd2LuxGnLXfVztyIlpm46yFk/uZDiL11zHeA8BJqKnIKDvO4nHzl1QJ/6oZvPaMYIzdHN/Jd4tiVyA+anI9DnQN56ooArdE9yV+5f+un516UDugl1+QrSgf3Wj003rgR/74euqvQFXDpvAxxlDDI0zUXF1btf3zsi3AUiEEZ4Cr0h7vtDzBYrB/Q1AIlcf8KqMr4XCkoHvwisOf0VWrm4PwJc9Yy87ENAbepZrcv/aXfVz92JDJBYoyf9+e6gH4MzJBVaUeeC+dbPXvPMRz71kyuhCEPzSvp2tj8DS1UfLuoBQ+aAvwfSzosTvb84wB8Bs2UpUmq69mww01AJ8L1S00ANuJZSSCcYKAErIDm61cdNFxuoAvUkPxDu3KqmgULwBNB5G2NdSO0Jrqms5tx6p3d7ykvE9EFQHzlPLvT3i2wKa3OhT5x1L815sanDejwgTQP9fC301tBemPq9P5BP/gNQSwMEFAAAAAgA04hdXQ/tnnu2AgAALwsAAA0AAAB4bC9zdHlsZXMueG1s3VbbjpswEP0VxAeUEFoUqiRSlypSpbZaafehr04wxJIv1JiU7NfXYxNIdj2r7T4WlGDP8TkznhmHrDtz5vThSKmJBsFlt4mPxrSfk6Q7HKkg3QfVUmmRWmlBjJ3qJulaTUnVAUnwZLlY5IkgTMbbtezFTpguOqhemk28iJPtulZytixjb7BLiaDRifBNXBLO9pq5tUQwfvbmJRgOiisdGRsK3cQpWLonD6d+BlGOOoJJpcGYeA/+ez8un9V0s7ehLXbuulrvHp3lMc6ngLPYG7brlhhDtdzZieM44wsoGseP59ZG3GhyTpef4jcTOsVZBS6b8jrWNE3vPn51MlfUSdQ9bOR7pSuqp9jT+GLarjmtjaVr1hzhaVSbAGiMEnZQMdIoSdzGLoxxYGUPlPMH6JNf9Y32UEe+4N8qqHUE+bsMbUDj0Mv4Cehfq3ntK9nlu2Sjlp2UuevtbqSb/+6Vofea1mxw86Ge/GPq6ay+fKZO2pafv3DWSEH93t/scLsmF150VJo9WW/QjgdroDqOTlQbdri2/NGkfaSDGVs2GeoxZ1O6XPJuCjFZIzhVm/gnHFY+RxHte8YNk+PsyKqKyhf1sPKG7O2vwY2+XV/RmvTcPE7gJp7HP2jFelFMq+4hM+Oqefwd+i7Np0NofTFZ0YFW5Ti1nX7T8v4CwnNkPrgvEYzjsTACGOYHiwDjeBbm53/azwrdj8ew2FZBZIVyVijHs0JI6W7MT5hT2Cu806LIsjzHMlqWwQhKLG95Dp+wGhYbMDA/4Onfco1XG++Q1/sAq+lrHYLtFO9EbKd4rgEJ5w0YRRGuNuYHGFgVsN4B/2E/0FNhTpZBVbHYsBOMI0WBIdCL4R7NcyQ7Odzh+mCnJMuKIowAFo4gyzAETiOOYBFADBiSZe49+Ox9lFzeU8n8F3n7F1BLAwQUAAAACADTiF1dl4q7HMAAAAATAgAACwAAAF9yZWxzLy5yZWxznZK5bsMwDEB/xdCeMAfQIYgzZfEWBPkBVqIP2BIFikWdv6/apXGQCxl5PTwS3B5pQO04pLaLqRj9EFJpWtW4AUi2JY9pzpFCrtQsHjWH0kBE22NDsFosPkAuGWa3vWQWp3OkV4hc152lPdsvT0FvgK86THFCaUhLMw7wzdJ/MvfzDDVF5UojlVsaeNPl/nbgSdGhIlgWmkXJ06IdpX8dx/aQ0+mvYyK0elvo+XFoVAqO3GMljHFitP41gskP7H4AUEsDBBQAAAAIANOIXV25FXp2NgEAACcCAAAPAAAAeGwvd29ya2Jvb2sueG1sjZHRSsNAEEV/JewHmFS0YGn6YlELosVK3zfJpBm6uxNmJ632650kBAu++LSZO8vde0+WZ+JjQXRMvrwLMTeNSLtI01g24G28oRaCbmpib0VHPqSxZbBVbADEu/Q2y+aptxjMajl5bTm9HkigFKSgYi/sEc7xd9+PyQkjFuhQvnMzfDswiceAHi9Q5SYzSWzo/EKMFwpi3a5kci43s3GxBxYs/8i7PuSnLeKgiC0+rAbJzTxTwxo5ynBj8Lea8QR6eZw6oSd0Ary2As9MXYvh0Ntoi/SqxsBhOkeIC/4PRqprLGFNZechyMiRwfUBQ2ywjSYJ1kNuFGDVDQD7UvrKphoLiia7wsUL1AVvqjHjFKyCGgNUb+oVVVdI5ZaT/hh8bu/uZw8Ko3PuUbX38Eq2mnpO/2j1A1BLAwQUAAAACADTiF1dJB6boq0AAAD4AQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxztZE9DoMwDIWvEuUANVCpQwVMXVgrLhAF8yMSEsWuCrcvhQGQOnRhsp4tf+/JTp9oFHduoLbzJEZrBspky+zvAKRbtIouzuMwT2oXrOJZhga80r1qEJIoukHYM2Se7pminDz+Q3R13Wl8OP2yOPAPMLxd6KlFZClKFRrkTMJotjbBUuLLTJaiqDIZiiqWcFog4skgbWlWfbBPTrTneRc390WuzeMJrt8McHh0/gFQSwMEFAAAAAgA04hdXWWQeZIZAQAAzwMAABMAAABbQ29udGVudF9UeXBlc10ueG1srZNNTsMwEIWvEmVbJS4sWKCmG2ALXXABY08aq/6TZ1rS2zNO2kqgEhWFTax43rzPnpes3o8RsOid9diUHVF8FAJVB05iHSJ4rrQhOUn8mrYiSrWTWxD3y+WDUMETeKooe5Tr1TO0cm+peOl5G03wTZnAYlk8jcLMakoZozVKEtfFwesflOpEqLlz0GBnIi5YUIqrhFz5HXDqeztASkZDsZGJXqVjleitQDpawHra4soZQ9saBTqoveOWGmMCqbEDIGfr0XQxTSaeMIzPu9n8wWYKyMpNChE5sQR/x50jyd1VZCNIZKaveCGy9ez7QU5bg76RzeP9DGk35IFiWObP+HvGF/8bzvERwu6/P7G81k4af+aL4T9efwFQSwECFAMUAAAACADTiF1dRsdNSJUAAADNAAAAEAAAAAAAAAAAAAAAgAEAAAAAZG9jUHJvcHMvYXBwLnhtbFBLAQIUAxQAAAAIANOIXV3XyS6E7wAAACsCAAARAAAAAAAAAAAAAACAAcMAAABkb2NQcm9wcy9jb3JlLnhtbFBLAQIUAxQAAAAIANOIXV2ZXJwjEAYAAJwnAAATAAAAAAAAAAAAAACAAeEBAAB4bC90aGVtZS90aGVtZTEueG1sUEsBAhQDFAAAAAgA04hdXQoIb6iwAwAAnA8AABgAAAAAAAAAAAAAAICBIggAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLAQIUAxQAAAAIANOIXV0P7Z57tgIAAC8LAAANAAAAAAAAAAAAAACAAQgMAAB4bC9zdHlsZXMueG1sUEsBAhQDFAAAAAgA04hdXZeKuxzAAAAAEwIAAAsAAAAAAAAAAAAAAIAB6Q4AAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgA04hdXbkVenY2AQAAJwIAAA8AAAAAAAAAAAAAAIAB0g8AAHhsL3dvcmtib29rLnhtbFBLAQIUAxQAAAAIANOIXV0kHpuirQAAAPgBAAAaAAAAAAAAAAAAAACAATURAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUAxQAAAAIANOIXV1lkHmSGQEAAM8DAAATAAAAAAAAAAAAAACAARoSAABbQ29udGVudF9UeXBlc10ueG1sUEsFBgAAAAAJAAkAPgIAAGQTAAAAAA==";
const MONTHS_LONG = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// OneDrive does not allow these in file or folder names.
const odName = (s) => String(s || "").replace(/["*:<>?/\\|#%]+/g, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "").slice(0, 80) || "Unnamed";
/* The team lead(s) of a client: roster team leads whose projects are matched to it. Nobody matched: the lead most of its billers report to. */
async function clientTeamLeads(env, clientId, byUserId) {
  const c = await one(env, "SELECT roster_names_json FROM clients WHERE id = ?", clientId);
  const names = new Set(jsonList(c && c.roster_names_json).map(projKey));
  const leads = names.size ? (await all(env, "SELECT name, designation, projects_json FROM users WHERE active = 1 AND role IN ('supervisor','admin') AND roster_kind = 'lead'"))
    .filter((u) => /\b(sr\.? )?tl\b|team lead/i.test(u.designation || "") && jsonList(u.projects_json).some((p) => names.has(projKey(p && p.name != null ? p.name : p))))
    .map((u) => u.name) : [];
  if (leads.length) return [...new Set(leads)].sort();
  // No roster team lead matched: the lead most of the client's billers report to, so every save (and Third Eye) picks the same folder.
  const top = await one(env, `SELECT r.name, COUNT(*) AS n FROM claims c JOIN users u ON u.id = c.assigned_to JOIN users r ON r.id = u.reports_to
    WHERE c.client_id = ? GROUP BY r.id ORDER BY n DESC, r.name LIMIT 1`, clientId);
  return [top && top.name ? top.name : "No team lead"];
}
function b64Bytes(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
/* ---- each client's own folders ----
   When a client is added (and once for every existing client) Brahmastra makes, in the Purviewautomate OneDrive:
     Brahmastra Clients / <Client> / Inventory    the client's inventory files; Upload inventory opens here
     Brahmastra Clients / <Client> / Production / AR | Payment posting | Submission | Rejections
        one file per scope per month ("AR Production - <Client> - Nov 2026.xlsx"), one row per entry: AR from the
        billers' saved entries, the others from every action their desk takes on a hand-off
   with a link anyone at Purview can open (organisation sharing link), so the team reaches them without asking. */
const CLIENT_ROOT = "Brahmastra Clients";
const SCOPE_FOLDER = { ar: "AR", posting: "Payment posting", submission: "Submission", rejection: "Rejections" };
const DEPT_SCOPE = { posting: "posting", submission: "submission", subcheck: "submission", rejection: "rejection" };
const DESK_HEADER = ["Sr. No", "Date", "Department", "Done by", "Client", "Location", "Claim #", "Account #", "Patient", "Payer", "DOS", "Balance", "Action", "Proof date",
  "Check / reference", "Amount", "Reason / code", "Comment", "Sent by (AR)", "Sent at", "Within TAT"];   // the client's own TAT (the hand-off's due time), not always 24 hours
/* Submission: the team's Production Format Conso layout, one row per Submission action on a claim. Most columns come from the claim's
   inventory row (the client's own columns too: NAEC Order No, the VEC columns), the old status / comment / bucket the inventory file had,
   the hand-off and the person; Type, Inventory Status, Comment, Bucket and Claim Type are what the person enters (editable for now).
   Allocation is left blank. The headers are the team's, spelling included, so their lookups keep working. */
const SUB_HEADER = ["Client", "UID", "Date", "Patient", "Invoice", "NAEC Order No", "VEC S/W Insurance Name", "Insurance", "Balance", "VEC Patient Balance", "Location", "Type",
  "VEC Claims Sourse", "VEC Submission Type", "Old status", "Old Comment", "old bucket", " Old Onhold/Pending ", "Allocation Date", "Allocation", "DOW", "EMPID", "Worked by",
  "Inventory Status", "Comment", "Bucket", "Claim Type"];
/* Payment posting: one row per claim, with the amounts the poster enters when they mark it Completed (allowed, paid, adjustment,
   patient responsibility, write-off) next to what Brahmastra knows (client, patient, insurance, DOS, invoice, CPT, billed, balance). */
const POST_HEADER = ["Client", "UID", "Date", "Patient", "Invoice", "Insurance", "Location", "CPT", "Billed", "Balance", "Check / EFT #", "Check / EFT date", "Payment type", "Posted date",
  "Allowed", "Paid", "Adjustment", "Adjustment reason", "Deductible", "Co-insurance", "Co-pay", "Patient responsibility", "Write-off", "Balance after posting",
  "Allocation Date", "Allocation", "DOW", "EMPID", "Posted by", "Status", "Comment"];
// each desk's rows go to a tab of its own in the month's file
const DESK_SHEET = { posting: "Payment posting", submission: "Submission", rejection: "Rejections" };
// a column of the client's inventory file, whatever its spacing or case ("VEC S/W Insurance Name", "vec s/w insurance name"); the first name found wins
const normKey = (k) => String(k == null ? "" : k).toLowerCase().replace(/[^a-z0-9]/g, "");
function rawPick(raw, ...names) {
  const m = new Map(); for (const [k, v] of Object.entries(raw || {})) if (v !== "" && v != null && !m.has(normKey(k))) m.set(normKey(k), String(v).trim());
  for (const n of names) { const v = m.get(normKey(n)); if (v) return v; }
  return "";
}
// an amount from the client's file; a credit (in brackets, or with a minus sign or CR before or after it: 45.00CR, CR 45.00) is negative
const moneyCell = (v) => {
  if (v === "" || v == null) return "";
  if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) / 100 : String(v);
  const t = String(v).toUpperCase().replace(/[$,\s]/g, ""), credit = /^(\(|\u2212|CR)/.test(t) || /(-|\u2212|CR)$/.test(t);
  const n = parseFloat(t.replace(/^(\(|\u2212|CR)/, ""));
  return isFinite(n) ? Math.round((credit ? -Math.abs(n) : n) * 100) / 100 : String(v);
};
// the claim type the AR biller's SAAG action already says (editable in the form)
const claimTypeOf = (action) => (/^Need to Resubmit$/i.test(action || "") ? "Resubmission" : /^Need to Submit Paper Claim$/i.test(action || "") ? "Paper claim"
  : /^Correction, Resubmission & Reprocessing$/i.test(action || "") ? "Corrected claim" : "");
// dates are Excel date numbers shown as mm/dd/yyyy (the cell format is set with the row), so no locale can read 11/10 as 10 Nov
const dateCell = (v) => { const iso = isoDate(String(v || "").slice(0, 10)); return iso ? excelSerial(iso) : String(v || ""); };
const msDateCell = (ms) => (ms ? excelSerial(istISO(ms)) : "");
// each column's cell format: dates, money, everything else as it comes
const fmtFor = (header, dates, money) => header.map((h) => (dates.includes(h) ? "mm/dd/yyyy" : money.includes(h) ? "#,##0.00" : "General"));
// the same unique key the AR production file uses (patient, DOS, payer, CPT), when the inventory file has no UID of its own
const uidOf = (h, raw) => rawPick(raw, "UID", "Unique ID", "Uni") || [h.patient, excelSerial(isoDate(String(h.dos || "").slice(0, 10))), h.payer, h.cpt].map((x) => (x == null ? "" : x)).join("");
function submissionRow(h, user, proof, action, now, comment) {
  const raw = jsonObj(h.raw_json), done = h.status === "complete";
  const bucket = { complete: "Payer", back: "Purview", client: "Client", rejected: "Purview" }[h.status] || "";
  return [h.client_code || h.client_name || "", uidOf(h, raw), dateCell(h.dos), h.patient || "", h.claim_no || "",
    rawPick(raw, "NAEC Order No", "Order No", "Order Number"), rawPick(raw, "VEC S/W Insurance Name", "S/W Insurance Name", "Software Insurance Name"),
    h.payer || "", Number(h.balance) || 0, moneyCell(rawPick(raw, "VEC Patient Balance", "Patient Balance", "Pt Balance")), h.location_name || "",
    (done && proof.type) || rawPick(raw, "Type"), rawPick(raw, "VEC Claims Sourse", "VEC Claims Source", "Claims Source", "Claim Source"),
    rawPick(raw, "VEC Submission Type", "Submission Type") || (done && proof.mode) || "",
    h.file_status || rawPick(raw, "Old status"), h.file_comments || rawPick(raw, "Old Comment"), h.file_bucket || rawPick(raw, "old bucket"),
    rawPick(raw, "Old Onhold/Pending", "Onhold/Pending", "On hold/Pending", "On hold"),
    msDateCell(h.created_at), "", msDateCell(now), user.emp_id || "", user.name || "",
    (done && proof.inv_status) || action, comment, (done && proof.bucket) || bucket, (done && proof.claim_type) || claimTypeOf(h.saag_action)];
}
function postingRow(h, user, proof, action, now, comment) {
  const raw = jsonObj(h.raw_json), done = h.status === "complete", p = done ? proof : {};
  const n = (v) => (v == null || v === "" ? "" : Number(v));
  const paid = p.paid != null ? p.paid : p.amount;
  const pr = [p.deductible, p.coinsurance, p.copay].some((v) => v != null && v !== "") ? Math.round(((Number(p.deductible) || 0) + (Number(p.coinsurance) || 0) + (Number(p.copay) || 0)) * 100) / 100 : "";
  const after = paid != null && paid !== "" ? Math.round(((Number(h.balance) || 0) - (Number(paid) || 0) - (Number(p.adjustment) || 0) - (Number(p.writeoff) || 0)) * 100) / 100 : "";
  return [h.client_code || h.client_name || "", uidOf(h, raw), dateCell(h.dos), h.patient || "", h.claim_no || "", h.payer || "", h.location_name || "", h.cpt || "",
    n(h.billed), Number(h.balance) || 0, p.ref || "", p.check_date ? dateCell(p.check_date) : "", p.pay_type || "", p.date ? dateCell(p.date) : "",
    n(p.allowed), n(paid), n(p.adjustment), p.adj_reason || "", n(p.deductible), n(p.coinsurance), n(p.copay), pr, n(p.writeoff), after,
    msDateCell(h.created_at), "", msDateCell(now), user.emp_id || "", user.name || "", done ? "Posted" : action, comment];
}
const AR_FMT = fmtFor(WORKBOOK_HEADER, ["DOS", "Date Worked"], ["Billed Amount($)", "Balance Amount($)"]);
const SUB_FMT = fmtFor(SUB_HEADER, ["Date", "Allocation Date", "DOW"], ["Balance", "VEC Patient Balance"]);
const POST_FMT = fmtFor(POST_HEADER, ["Date", "Check / EFT date", "Posted date", "Allocation Date", "DOW"],
  ["Billed", "Balance", "Allowed", "Paid", "Adjustment", "Deductible", "Co-insurance", "Co-pay", "Patient responsibility", "Write-off", "Balance after posting"]);
/* A desk's row goes to its own tab (Payment posting, Submission, Rejections) under that tab's header. A new month's file starts from
   the AR template (the AR header on Sheet1): that tab is renamed and given the desk's header. A file already holding rows in another
   layout (earlier in the month) gets a new tab, so no tab mixes two layouts. */
async function appendDeskRow(tok, loc, values, header, sheetName, formats) {
  const base = `/drives/${encodeURIComponent(loc.driveId)}/items/${encodeURIComponent(loc.itemId)}/workbook`;
  const list = ((await graphCall(tok, "GET", base + "/worksheets?$select=id,name")) || {}).value || [];
  const same = (a, b) => String(a == null ? "" : a).trim().toLowerCase() === String(b == null ? "" : b).trim().toLowerCase();
  const rowIs = (vals, hdr) => Array.isArray(vals) && hdr.every((x, i) => same(vals[i], x));
  const usedOf = (id) => graphCall(tok, "GET", base + "/worksheets/" + encodeURIComponent(id) + "/usedRange(valuesOnly=true)?$select=rowCount,address,values");
  const blank = (u) => !u || (u.rowCount <= 1 && (!u.values || !u.values[0] || u.values[0].every((v) => v === "" || v == null)));
  let sheet = list.find((x) => same(x.name, sheetName)) || null, used = sheet ? await usedOf(sheet.id) : null;
  if (!sheet && list[0]) {
    const u = await usedOf(list[0].id), first = u && u.values && u.values[0];
    if (blank(u) || rowIs(first, header) || (u.rowCount <= 1 && rowIs(first, WORKBOOK_HEADER))) {
      sheet = list[0]; used = u;
      try { await graphCall(tok, "PATCH", base + "/worksheets/" + encodeURIComponent(sheet.id), { name: sheetName }); } catch (e) {}
    } else {
      try { const add = await graphCall(tok, "POST", base + "/worksheets/add", { name: sheetName }); if (add && add.id) { sheet = add; used = null; } } catch (e) {}
      if (!sheet) { sheet = list[0]; used = u; }   // a tab could not be added: the row is still kept, on the first tab
    }
  }
  if (!sheet) throw new ApiError(400, "The workbook has no worksheet.");
  const ws = base + "/worksheets/" + encodeURIComponent(sheet.id);
  let startRow;
  if (!rowIs(used && used.values && used.values[0], header) && (blank(used) || used.rowCount <= 1)) {
    // this desk's header on row 1 (over the template's AR header, cleared to its last column), then the row under it
    const width = Math.max(header.length, WORKBOOK_HEADER.length);
    await writeRange(tok, ws + `/range(address='A1:${colLetter(width)}1')`, [[...header, ...Array(width - header.length).fill("")]]);
    try { await graphCall(tok, "PATCH", ws + `/range(address='A1:${colLetter(header.length)}1')/format/font`, { bold: true, color: "#FFFFFF" });
      await graphCall(tok, "PATCH", ws + `/range(address='A1:${colLetter(header.length)}1')/format/fill`, { color: "#111B4D" }); } catch (e) {}
    startRow = 2;
  } else startRow = (parseInt(String(used.address).replace(/^.*![A-Z]+\d+:?[A-Z]*/, "").replace(/\D/g, ""), 10) || used.rowCount) + 1;
  const row = values.map((v) => (v === SR_NO ? startRow - 1 : v));
  await writeRange(tok, ws + `/range(address='A${startRow}:${colLetter(row.length)}${startRow}')`, [row], formats ? [formats] : null);
  return loc.name;
}
async function odChild(tok, driveId, parentId, name) {
  try { return await graphCall(tok, "POST", `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`, { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }); }
  catch (e) { if (!/\(409/.test(String(e.message))) throw e; return graphCall(tok, "GET", `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}?$select=id,name,parentReference,webUrl`); }
}
async function odShareLink(tok, driveId, itemId, fallback) {
  try { const r = await graphCall(tok, "POST", `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/createLink`, { type: "edit", scope: "organization" }); return (r && r.link && r.link.webUrl) || fallback || ""; }
  catch (e) { return fallback || ""; }
}
async function ensureClientFolders(env, clientId, tok) {
  const c = await one(env, "SELECT * FROM clients WHERE id = ?", clientId);
  if (!c) return null;
  const have = jsonObj(c.od_prod_json);
  if (c.od_drive_id && c.od_folder_id && c.od_inventory_id && c.od_production_id && Object.keys(SCOPE_FOLDER).every((k) => have[k] && have[k].id)) return c;
  try {
    tok = tok || await graphAppToken(env);
    const owner = encodeURIComponent(env.REPORTS_OWNER || REPORTS_OWNER_DEFAULT);
    let root;
    try { root = await graphCall(tok, "POST", `/users/${owner}/drive/root/children`, { name: CLIENT_ROOT, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }); }
    catch (e) { if (!/\(409/.test(String(e.message))) throw e; root = await graphCall(tok, "GET", `/users/${owner}/drive/root:/${encodeURIComponent(CLIENT_ROOT)}?$select=id,name,parentReference,webUrl`); }
    const drive = root.parentReference.driveId;
    const folder = await odChild(tok, drive, root.id, odName(c.name));
    const inv = await odChild(tok, drive, folder.id, "Inventory");
    const prod = await odChild(tok, drive, folder.id, "Production");
    const link = await odShareLink(tok, drive, folder.id, folder.webUrl), invLink = await odShareLink(tok, drive, inv.id, inv.webUrl), prodLink = await odShareLink(tok, drive, prod.id, prod.webUrl);
    const scopes = {};
    for (const [k, nm] of Object.entries(SCOPE_FOLDER)) { const f = (have[k] && have[k].id) ? have[k] : null; if (f) { scopes[k] = f; continue; } const it = await odChild(tok, drive, prod.id, nm); scopes[k] = { id: it.id, link: await odShareLink(tok, drive, it.id, it.webUrl), path: [CLIENT_ROOT, odName(c.name), "Production", nm].join(" › ") }; }
    await run(env, `UPDATE clients SET od_drive_id = ?, od_folder_id = ?, od_inventory_id = ?, od_production_id = ?, od_link = ?, od_inventory_link = ?, od_production_link = ?, od_prod_json = ?, od_status_json = ? WHERE id = ?`,
      drive, folder.id, inv.id, prod.id, link, invLink, prodLink, JSON.stringify(scopes), JSON.stringify({ ok: true, at: Date.now(), path: [CLIENT_ROOT, odName(c.name)].join(" › ") }), c.id);
    if (!c.od_folder_id) await audit(env, null, "client.folders", c.id, `OneDrive folders made: ${CLIENT_ROOT} › ${odName(c.name)} › Inventory; Production › AR, Payment posting, Submission, Rejections`);
    return one(env, "SELECT * FROM clients WHERE id = ?", c.id);
  } catch (e) {
    await run(env, "UPDATE clients SET od_status_json = ? WHERE id = ?", JSON.stringify({ ok: false, at: Date.now(), error: String(e && e.message || e).slice(0, 300) }), c.id);
    throw e;
  }
}
/* The month's Production workbook in the client's Production folder: found, or made from the template the first time. */
async function clientProductionFile(env, tok, clientId, ms, scope = "ar") {
  const c = await ensureClientFolders(env, clientId, tok);
  const folderId = (jsonObj(c.od_prod_json)[scope] || {}).id;
  if (!folderId) throw new ApiError(502, "The " + SCOPE_FOLDER[scope] + " production folder is missing.");
  const d = istDate(ms), month = MONTHS_LONG[d.getUTCMonth()] + " " + d.getUTCFullYear();
  const name = odName(SCOPE_FOLDER[scope] + " Production - " + c.name + " - " + month) + ".xlsx";
  const key = "cp:" + folderId + ":" + (await sha256Hex(name.toLowerCase())).slice(0, 16);
  const cached = await one(env, "SELECT value_json FROM settings WHERE key = ?", key);
  if (cached) { try { const loc = JSON.parse(cached.value_json); if (loc.driveId) return loc; } catch {} }
  const at = `/drives/${encodeURIComponent(c.od_drive_id)}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:`;
  let it = null;
  try { it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference"); }
  catch (e) {
    if (!/\(404/.test(String(e.message))) throw e;
    const r = await fetchT("https://graph.microsoft.com/v1.0" + at + "/content?@microsoft.graph.conflictBehavior=fail", { method: "PUT",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: b64Bytes(PROD_TEMPLATE_B64) });
    if (r.ok) it = await r.json();
    else if (r.status === 409) it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference");
    else throw new ApiError(502, "OneDrive did not create " + name + " (" + r.status + ").");
  }
  const loc = { driveId: it.parentReference.driveId, itemId: it.id, name: it.name, path: [CLIENT_ROOT, odName(c.name), "Production", SCOPE_FOLDER[scope], it.name].join(" › ") };
  await run(env, "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?,?,?)", key, JSON.stringify(loc), Date.now());
  return loc;
}
/* Every action a Payment posting / Submission / Rejections desk takes on a hand-off is a row in that scope's file. */
async function deskProduction(env, user, handoffId, outcome = "") {
  if (String(env.REPORTS_AUTO || "on").toLowerCase() === "off") return;
  const h = await one(env, `SELECT h.*, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, c.billed, c.cpt, c.file_status, c.file_comments, c.file_bucket, c.raw_json,
      cl.name AS client_name, cl.code AS client_code, l.name AS location_name
    FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = h.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE h.id = ?`, handoffId);
  if (!h) return;
  const scope = DEPT_SCOPE[h.dept] || "submission", proof = jsonObj(h.proof_json), now = Date.now();
  // the status of the step just taken: In process, Pending and Other leave the hand-off's own status as it was
  const done = { complete: h.dept === "posting" ? "Completed: payment posted" : h.dept === "subcheck" ? "Recheck: accepted" : "Completed: submitted" };
  const action = (outcome && { ...done, rejected: "Rejected", pending: "Pending", inprocess: "In process", other: "Other" + (h.reason ? ": " + h.reason : ""), back: "Need assistance from AR",
    client: "Need assistance from client", resume: "Client answered (back to open)" }[outcome])
    || { ...done, pending: "Pending", back: "Need assistance from AR", client: "Need assistance from client", rejected: "Rejected", assigned: "Client answered (back to open)", pending_open: "Pending" }[h.status] || h.status;
  // the comment of this step: its own reason where the step has one, never an older step's
  const step = outcome || h.status;
  const comment = ["back", "client", "other", "rejected"].includes(step) ? [h.reason, h.note].filter(Boolean).join(": ") : (h.note || "");
  // Submission (with its rechecks) in the team's Conso layout, Payment posting with the amounts, Rejections as before
  const header = scope === "submission" ? SUB_HEADER : scope === "posting" ? POST_HEADER : DESK_HEADER;
  const row = scope === "submission" ? submissionRow(h, user, proof, action, now, comment) : scope === "posting" ? postingRow(h, user, proof, action, now, comment)
    : [SR_NO, excelSerial(istISO(now)), DEPT_LABEL[h.dept] || h.dept, user.name || "", h.client_name || "", h.location_name || "", h.claim_no || "", h.account_no || "", h.patient || "", h.payer || "",
    h.dos || "", Number(h.balance) || 0, action, proof.date || "", proof.ref || proof.code || "", proof.amount == null ? "" : Number(proof.amount), h.reason || "", h.note || "", h.created_by_name || "",
    h.created_at ? excelSerial(istISO(h.created_at)) : "", h.due_at ? (now <= h.due_at ? "Yes" : "No") : ""];
  try {
    const tok = await graphAppToken(env);
    const loc = await clientProductionFile(env, tok, h.client_id, now, scope);
    await appendDeskRow(tok, loc, row, header, DESK_SHEET[scope] || SCOPE_FOLDER[scope], scope === "submission" ? SUB_FMT : scope === "posting" ? POST_FMT : null);
    await recordWorkbookStatus(env, h.client_id + ":" + scope, { ok: true, at: now, file: loc.path, claim_no: h.claim_no });
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await recordWorkbookStatus(env, h.client_id + ":" + scope, { ok: false, at: now, error: msg, claim_no: h.claim_no });
    try { await folderTrouble(env, h.client_id, msg); } catch (x) {}
  }
}
/* When a client's folders or production file cannot be written, its AR person and team leads hear about it once a day. */
async function folderTrouble(env, clientId, error) {
  const day = istISO(Date.now()), key = "odfail:" + clientId + ":" + day;
  if (await one(env, "SELECT 1 AS x FROM settings WHERE key = ?", key)) return;
  await setSetting(env, key, true);
  const c = await one(env, "SELECT id, name, ar_mode, ar_lead FROM clients WHERE id = ?", clientId);
  if (!c) return;
  const leadNames = await clientTeamLeads(env, c.id, null);
  const people = await all(env, `SELECT id, email, email_missing FROM users WHERE active = 1 AND (id = ? OR name IN (${leadNames.map(() => "?").join(",") || "NULL"}))`, c.ar_mode === "person" ? c.ar_lead : "", ...leadNames);
  const text = `Brahmastra could not save production to ${c.name}'s OneDrive folder: ${String(error).slice(0, 160)}. Entries are still saved in Brahmastra; tell your admin.`;
  for (const u of people) {
    await run(env, "INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)", uuid(), u.id, Date.now(), text, "clients", c.id);
    if (env.EMAIL_PROVIDER && u.email && !u.email_missing) { try { await sendEmail(env, { to: u.email, subject: `Production file problem: ${c.name}`, text, html: `<p style="font:14px Segoe UI,Arial,sans-serif">${htmlEsc(text)}</p>` }); } catch (e) {} }
  }
}
async function recordWorkbookStatus(env, targetId, status) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?,?,?)", "workbook_status:" + targetId, JSON.stringify(status), Date.now());
}
/* ---- the escalation tracker's OneDrive file ----
   One workbook per client, in its own folder: Brahmastra Clients / <Client> / Escalation Tracker - <Client>.xlsx.
   Every change rewrites the sheet from Brahmastra's register, so an edit or a resolution shows on the same row.
   The first four columns (SR No, Department, Description, Date) are the ones Drishti counts for the Escalations KPI. */
const ESC_HEADER = ["SR No", "Department", "Client Name", "Received (mm/dd/yy)", "Raised by", "Reported to Purview", "Responding person Purview", "Email Subject",
  "Error description", "Error (Y/N)", "Comment", "Root Cause", "Corrective Action", "Preventive Action", "Status (Open/Closed)", "Close date (mm/dd/yy)",
  "Working hours to close", "Reason still open (after 24 h)", "Expected close date", "Reason given by", "Logged by", "Escalation type", "Error by", "DOW of error (mm/dd/yy)",
  "Location", "Month", "Channels Used (Email/Teams/Call)", "Review Date (mm/dd/yy)", "Review Result", "Rework Completed (Yes/No)",
  "Logged on (IST)", "Last updated by", "Last updated on (IST)"];
// a moment as "mm/dd/yy hh:mm" in Indian time
const istStamp = (ms) => { if (!ms) return ""; const d = istDate(ms), p = (n) => String(n).padStart(2, "0"); return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${String(d.getUTCFullYear()).slice(2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const ESC_DATE_COLS = new Set([3, 15, 18, 23, 27]);
const ESC_CHANNELS = ["Email", "Teams", "Call"];
const ESC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// the review result is the Error (Y/N) answer: Y is an error on our side, N is not
const escReviewResult = (e) => (e.is_error === "Y" ? "Error" : e.is_error === "N" ? "No error" : "");
const ESC_TEMPLATE_B64 = "UEsDBBQAAAAIAFaCZV1Gx01IlQAAAM0AAAAQAAAAZG9jUHJvcHMvYXBwLnhtbE3PTQvCMAwG4L9SdreZih6kDkQ9ip68zy51hbYpbYT67+0EP255ecgboi6JIia2mEXxLuRtMzLHDUDWI/o+y8qhiqHke64x3YGMsRoPpB8eA8OibdeAhTEMOMzit7Dp1C5GZ3XPlkJ3sjpRJsPiWDQ6sScfq9wcChDneiU+ixNLOZcrBf+LU8sVU57mym/8ZAW/B7oXUEsDBBQAAAAIAFaCZV0la1X+7wAAACsCAAARAAAAZG9jUHJvcHMvY29yZS54bWzNklFLwzAQx7+K5L29pptFQtcXxScFwYHiW0huW1jThOSk3bc3jVuH6AfwMXf//O53cK3yQrmAL8F5DGQw3ky2H6JQfsMORF4ARHVAK2OZEkNq7lywktIz7MFLdZR7hLqqGrBIUkuSMAMLvxBZ12olVEBJLpzxWi14/xn6DNMKsEeLA0XgJQfWzRP9aepbuAJmGGGw8buAeiHm6p/Y3AF2Tk7RLKlxHMtxlXNpBw7vz0+ved3CDJHkoDD9ikbQyeOGXSa/re4fto+sq6u6KTgvqtstbwS/E+v1x+z6w+8qbJ02O/OPjS+CXQu/7qL7AlBLAwQUAAAACABWgmVdmVycIxAGAACcJwAAEwAAAHhsL3RoZW1lL3RoZW1lMS54bWztWltz2jgUfu+v0Hhn9m0LxjaBtrQTc2l227SZhO1OH4URWI1seWSRhH+/RzYQy5YN7ZJNups8BCzp+85FR+foOHnz7i5i6IaIlPJ4YNkv29a7ty/e4FcyJBFBMBmnr/DACqVMXrVaaQDDOH3JExLD3IKLCEt4FMvWXOBbGi8j1uq0291WhGlsoRhHZGB9XixoQNBUUVpvXyC05R8z+BXLVI1lowETV0EmuYi08vlsxfza3j5lz+k6HTKBbjAbWCB/zm+n5E5aiOFUwsTAamc/VmvH0dJIgILJfZQFukn2o9MVCDINOzqdWM52fPbE7Z+Mytp0NG0a4OPxeDi2y9KLcBwE4FG7nsKd9Gy/pEEJtKNp0GTY9tqukaaqjVNP0/d93+ubaJwKjVtP02t33dOOicat0HgNvvFPh8Ouicar0HTraSYn/a5rpOkWaEJG4+t6EhW15UDTIABYcHbWzNIDll4p+nWUGtkdu91BXPBY7jmJEf7GxQTWadIZljRGcp2QBQ4AN8TRTFB8r0G2iuDCktJckNbPKbVQGgiayIH1R4Ihxdyv/fWXu8mkM3qdfTrOa5R/aasBp+27m8+T/HPo5J+nk9dNQs5wvCwJ8fsjW2GHJ247E3I6HGdCfM/29pGlJTLP7/kK6048Zx9WlrBdz8/knoxyI7vd9lh99k9HbiPXqcCzIteURiRFn8gtuuQROLVJDTITPwidhphqUBwCpAkxlqGG+LTGrBHgE323vgjI342I96tvmj1XoVhJ2oT4EEYa4pxz5nPRbPsHpUbR9lW83KOXWBUBlxjfNKo1LMXWeJXA8a2cPB0TEs2UCwZBhpckJhKpOX5NSBP+K6Xa/pzTQPCULyT6SpGPabMjp3QmzegzGsFGrxt1h2jSPHr+BfmcNQockRsdAmcbs0YhhGm78B6vJI6arcIRK0I+Yhk2GnK1FoG2camEYFoSxtF4TtK0EfxZrDWTPmDI7M2Rdc7WkQ4Rkl43Qj5izouQEb8ehjhKmu2icVgE/Z5ew0nB6ILLZv24fobVM2wsjvdH1BdK5A8mpz/pMjQHo5pZCb2EVmqfqoc0PqgeMgoF8bkePuV6eAo3lsa8UK6CewH/0do3wqv4gsA5fy59z6XvufQ9odK3NyN9Z8HTi1veRm5bxPuuMdrXNC4oY1dyzcjHVK+TKdg5n8Ds/Wg+nvHt+tkkhK+aWS0jFpBLgbNBJLj8i8rwKsQJ6GRbJQnLVNNlN4oSnkIbbulT9UqV1+WvuSi4PFvk6a+hdD4sz/k8X+e0zQszQ7dyS+q2lL61JjhK9LHMcE4eyww7ZzySHbZ3oB01+/ZdduQjpTBTl0O4GkK+A226ndw6OJ6YkbkK01KQb8P56cV4GuI52QS5fZhXbefY0dH758FRsKPvPJYdx4jyoiHuoYaYz8NDh3l7X5hnlcZQNBRtbKwkLEa3YLjX8SwU4GRgLaAHg69RAvJSVWAxW8YDK5CifEyMRehw55dcX+PRkuPbpmW1bq8pdxltIlI5wmmYE2eryt5lscFVHc9VW/Kwvmo9tBVOz/5ZrcifDBFOFgsSSGOUF6ZKovMZU77nK0nEVTi/RTO2EpcYvOPmx3FOU7gSdrYPAjK5uzmpemUxZ6by3y0MCSxbiFkS4k1d7dXnm5yueiJ2+pd3wWDy/XDJRw/lO+df9F1Drn723eP6bpM7SEycecURAXRFAiOVHAYWFzLkUO6SkAYTAc2UyUTwAoJkphyAmPoLvfIMuSkVzq0+OX9FLIOGTl7SJRIUirAMBSEXcuPv75Nqd4zX+iyBbYRUMmTVF8pDicE9M3JD2FQl867aJguF2+JUzbsaviZgS8N6bp0tJ//bXtQ9tBc9RvOjmeAes4dzm3q4wkWs/1jWHvky3zlw2zreA17mEyxDpH7BfYqKgBGrYr66r0/5JZw7tHvxgSCb/NbbpPbd4Ax81KtapWQrET9LB3wfkgZjjFv0NF+PFGKtprGtxtoxDHmAWPMMoWY434dFmhoz1YusOY0Kb0HVQOU/29QNaPYNNByRBV4xmbY2o+ROCjzc/u8NsMLEjuHti78BUEsDBBQAAAAIAFaCZV2a6/JUUgMAAAEMAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sjZbbcpswEIZfRcOVexMMsXMa45nESZq2iUPtpp1eyiBjNQJRScR2n74rDm6GSuAbG5C+Xyv90monWy5e5YYQhXYpy2TgbJTKr1xXRhuSYnnCc5JBy5qLFCt4FYkrc0FwXEIpc/3h8MxNMc2c6aT8ForphBeK0YyEAskiTbHY3xDGt4HjOc2HBU02Sn9wp5McJ2RJ1EseCnhzDyoxTUkmKc+QIOvAufauXsr+ZYfvlGzlu2ekZ7Li/FW/fIoDZ+ho5Yyg3TJntBwL7f89Kp4/krWaEcYC58Z3EI4UfSMhEIGz4krxtIwRIlZYwbe14H9IVo5PGIHOEFde9gapqquhrVLSI9lb63GqAKqArvVK/a6n7RxWRc/t/XOzAPelPbDcKyzJjLMfNFabwLlwUEzWuGBqwbcPpF7ysdaLOJPlL9oe+kaFhGhqFgJIaVb9413t1Lv+/tAC+DXgt4GRBTitgdMW4NmAUQ2Mjg1pXAPjY4GzGjhrA74FOK+B8xZwahvhogYuWsDYBlzWwGV7lWyAbqicGx4blHcwu+32yIo0dnttv+1IY7jXdtyONJZ7bc+tm8RrTPfartuRxnav7bt9kRvjvbbz9rk01ntt7+2BNeZ7/7lvO7Z+477fdt+ONO77VcapUkSZX26xwtOJ4FskdH/Q0w9lkqqSaeDQTGf8pRLQSoFT0+UCzfnEVSClP7hRjd10Y7ckx0JB5lcGdtbNzhgFDs1xSgzwbTe8IBGBBByjQZq6cezu9x8MInc9IphKkFjtDeh93/g5FwpgxVFYiDfI7waRj30iMudZTLME5URIuGnsUg/dUndwqzO0LFa/4M4y4J96cCG4gPtHRoLm+s4zSHw+RmLw052bnPjSsxd4atlEjz1LyLlCM1xI0x566htUCFLe4+g6skx63i0RCvIGcXdKPPecPKhYCokGz1C8uTPGYUeaFjDsO0wAohiKn+4T8bVb5oEXQuo9HWk9A7/o29FYb2OpKGNIl6NogNeKCOSP0MYUz7JnU+1ycAiOWXSYn0Hk21FBJeBSZj7sL90CjzxJDHnChRzbFHhV0tXF8RMWCc0kYlBGQmF7cg53m6iqueoFKtByqKqeLB83UKMToTtA+xq2dPOiU/uh6p/+BVBLAwQUAAAACABWgmVd4qKCGq4CAAAbCwAADQAAAHhsL3N0eWxlcy54bWzdVtuOmzAQ/RXEB5QEWhqqJFIXaaVKbbXS5qGvTjDEki/UmJT06+uxCSRZz2rbx4ICnjk+M8fjsci6M2dOn4+UmmgQXHab+GhM+ylJusORCtK9Uy2VFqmVFsRYUzdJ12pKqg5IgifpYpEngjAZb9eyF4/CdNFB9dJs4kWcbNe1krMnjb3DTiWCRifCN3FJONtr5uYSwfjZu1NwHBRXOjJWCt3ES/B0vz289BaoHOMIJpUGZ+Iz+Od+nD5H083eSls8uutqvnt1lsc4nwRnsXds1y0xhmr5aA3Hcc4XUDSOd+fWKm40OS/TD/GbCZ3irIKUTXmtdfGQfnzvqplcUaeg7mWV75WuqJ60L+OLa7vmtDaWrllzhLdRbQKgMUrYQcVIoyRxC7swxoENe6CcP0Of/KhvYg915Df8SwV7HUH9LkMraBz6MN6A+NfRfOyrsOk/hY1adlLmoberkc7+2StDnzSt2eDsoZ7yY9GXc/T0LjppW37+zFkjBfVrf3PC7ZpceNGJasMO0IwHa1IdR780aXd0MGN7JkM91mcqjSvUTdEnbwQnaBN/h4PJ54zRvmfcMDlaR1ZVVL6ovQ1vyN6e/Jv4dn5Fa9Jzs5vATTyPv9GK9aKYZj1BFcZZ8/gr9Ngynw6czcVkRQdalaNpu/q2vd0FhHtkPqQvEYzjsTACGJYHU4BxPAvL8z+tZ4Wux2OYtlUQWaGcFcrxrBBSuhvLE+YU9gqvtCiyLM+xipZlUEGJ1S3P4ReOhmkDBpYHMv1drfHdxjvk9T7A9vS1DsFWincitlK81oCE6waMogjvNpYHGNguYL0D+cN5oKfCnCyDXcW0YScYR4oCQ6AXwz2a50h1crjD+4OdkiwrijACWFhBlmEInEYcwRSABgzJMvcdvPseJZfvVDL/Hd7+AVBLAwQUAAAACABWgmVdl4q7HMAAAAATAgAACwAAAF9yZWxzLy5yZWxznZK5bsMwDEB/xdCeMAfQIYgzZfEWBPkBVqIP2BIFikWdv6/apXGQCxl5PTwS3B5pQO04pLaLqRj9EFJpWtW4AUi2JY9pzpFCrtQsHjWH0kBE22NDsFosPkAuGWa3vWQWp3OkV4hc152lPdsvT0FvgK86THFCaUhLMw7wzdJ/MvfzDDVF5UojlVsaeNPl/nbgSdGhIlgWmkXJ06IdpX8dx/aQ0+mvYyK0elvo+XFoVAqO3GMljHFitP41gskP7H4AUEsDBBQAAAAIAFaCZV1jz6d5NQEAACgCAAAPAAAAeGwvd29ya2Jvb2sueG1sjVHLbsIwEPyVyB/QBNQiFREupQ+kqkWl4m6SDVlhe6P1Blq+vptEUZF66cme2dV4Zrw4Ex/3RMfky7sQc1OLNPM0jUUN3sYbaiDopCL2VhTyIY0Ngy1jDSDepdMsm6XeYjDLxai14fQakEAhSEHJjtghnOPvvIPJCSPu0aF856a/OzCJx4AeL1DmJjNJrOn8QowXCmLdtmByLjeTYbADFiz+0NvO5Kfdx54Ru/+waiQ3s0wFK+Qo/Uavb9XjCXR5QK3QEzoBXlmBZ6a2wXDoZDRFehWj72E8hxLn/J8aqaqwgBUVrYcgQ48MrjMYYo1NNEmwHnLzGDXYQHep9Jl1OSQUtXbVF89RB7wuB5OjsxIqDFC+qVhUXsWKDSfd0etMb+8m99pG69yDcu/hlWw5Bh0/afkDUEsDBBQAAAAIAFaCZV0kHpuirQAAAPgBAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHO1kT0OgzAMha8S5QA1UKlDBUxdWCsuEAXzIxISxa4Kty+FAZA6dGGyni1/78lOn2gUd26gtvMkRmsGymTL7O8ApFu0ii7O4zBPahes4lmGBrzSvWoQkii6QdgzZJ7umaKcPP5DdHXdaXw4/bI48A8wvF3oqUVkKUoVGuRMwmi2NsFS4stMlqKoMhmKKpZwWiDiySBtaVZ9sE9OtOd5Fzf3Ra7N4wmu3wxweHT+AVBLAwQUAAAACABWgmVdZZB5khkBAADPAwAAEwAAAFtDb250ZW50X1R5cGVzXS54bWytk01OwzAQha8SZVslLixYoKYbYAtdcAFjTxqr/pNnWtLbM07aSqASFYVNrHjevM+el6zejxGw6J312JQdUXwUAlUHTmIdIniutCE5SfyatiJKtZNbEPfL5YNQwRN4qih7lOvVM7Ryb6l46XkbTfBNmcBiWTyNwsxqShmjNUoS18XB6x+U6kSouXPQYGciLlhQiquEXPkdcOp7O0BKRkOxkYlepWOV6K1AOlrAetriyhlD2xoFOqi945YaYwKpsQMgZ+vRdDFNJp4wjM+72fzBZgrIyk0KETmxBH/HnSPJ3VVkI0hkpq94IbL17PtBTluDvpHN4/0MaTfkgWJY5s/4e8YX/xvO8RHC7r8/sbzWThp/5ovhP15/AVBLAQIUAxQAAAAIAFaCZV1Gx01IlQAAAM0AAAAQAAAAAAAAAAAAAACAAQAAAABkb2NQcm9wcy9hcHAueG1sUEsBAhQDFAAAAAgAVoJlXSVrVf7vAAAAKwIAABEAAAAAAAAAAAAAAIABwwAAAGRvY1Byb3BzL2NvcmUueG1sUEsBAhQDFAAAAAgAVoJlXZlcnCMQBgAAnCcAABMAAAAAAAAAAAAAAIAB4QEAAHhsL3RoZW1lL3RoZW1lMS54bWxQSwECFAMUAAAACABWgmVdmuvyVFIDAAABDAAAGAAAAAAAAAAAAAAAgIEiCAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsBAhQDFAAAAAgAVoJlXeKighquAgAAGwsAAA0AAAAAAAAAAAAAAIABqgsAAHhsL3N0eWxlcy54bWxQSwECFAMUAAAACABWgmVdl4q7HMAAAAATAgAACwAAAAAAAAAAAAAAgAGDDgAAX3JlbHMvLnJlbHNQSwECFAMUAAAACABWgmVdY8+neTUBAAAoAgAADwAAAAAAAAAAAAAAgAFsDwAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAVoJlXSQem6KtAAAA+AEAABoAAAAAAAAAAAAAAIABzhAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQDFAAAAAgAVoJlXWWQeZIZAQAAzwMAABMAAAAAAAAAAAAAAIABsxEAAFtDb250ZW50X1R5cGVzXS54bWxQSwUGAAAAAAkACQA+AgAA/RIAAAAA";
const ESC_DEPTS = ["Account Receivable", "Submission", "Payment Posting", "Benefit Verification", "PCC", "Credentialing", "Other"];
const ESC_STATUS = { open: "Open", progress: "Open", resolved: "Closed" };
/* External: raised by the client (these are the client's escalations, counted in its SLA). Internal: raised inside Purview
   (a manager, QA, another team); kept in the same register, not counted in the client's SLA. */
const ESC_KINDS = { external: "External", internal: "Internal" };
const escKind = (e) => (e && e.kind === "internal" ? "internal" : "external");
const isEscKind = (k) => k === "external" || k === "internal";
/* Working hours to close: from the received date (the time it was logged, when that was the same day) to the close date typed in
   (the time it was closed, when that was the same day; otherwise the end of that day). Not the save times: one logged late, or
   logged already closed, still counts from its own dates. */
const escHours = (e) => {
  if (e.status !== "resolved" || !e.day) return null;
  const closeDay = e.close_on || (e.resolved_at ? istISO(e.resolved_at) : ""); if (!closeDay) return null;
  const start = e.created_at && istISO(e.created_at) === e.day ? e.created_at : istDayStart(e.day);
  const end = e.resolved_at && istISO(e.resolved_at) === closeDay ? e.resolved_at : istDayEnd(closeDay);
  return Math.max(0, Math.round(workingHoursBetween(start, Math.max(start, end)) * 10) / 10);
};
const escRow = (e, client) => ["SR" + e.sr, e.dept, client || e.client_name || "", excelSerial(e.day), e.raised_who, e.reported_to, e.owner_name, e.email_subject,
  e.description, e.is_error, e.comment, e.rca, e.corrective, e.preventive, ESC_STATUS[e.status] || e.status, excelSerial(e.close_on),
  escHours(e) == null ? "" : escHours(e), e.delay_reason, excelSerial(e.expected_on), e.delay_by_name, e.created_by_name,
  ESC_KINDS[escKind(e)], e.is_error === "Y" ? e.error_by_name || "" : "", e.is_error === "Y" ? excelSerial(e.error_dow) : "",
  e.location_name || "", /^\d{4}-\d{2}/.test(e.day || "") ? ESC_MONTHS[+e.day.slice(5, 7) - 1] || "" : "", e.channels || "", excelSerial(e.review_on), escReviewResult(e), e.rework || "",
  istStamp(e.created_at), e.updated_by_name || e.created_by_name || "", istStamp(e.updated_at || e.created_at)];
// the dates show as mm/dd/yy in Excel
const escFormats = (n) => [ESC_HEADER.map(() => "General"), ...Array.from({ length: n }, () => ESC_HEADER.map((h, i) => (ESC_DATE_COLS.has(i) ? "mm/dd/yy" : "General")))];
async function escalationFile(env, tok, clientId) {
  const c = await ensureClientFolders(env, clientId, tok);
  const key = "escfile:" + clientId;
  const cached = await getSetting(env, key, null);
  if (cached && cached.driveId && cached.folderId === c.od_folder_id) return cached;
  const name = odName("Escalation Tracker - " + c.name) + ".xlsx";
  const at = `/drives/${encodeURIComponent(c.od_drive_id)}/items/${encodeURIComponent(c.od_folder_id)}:/${encodeURIComponent(name)}:`;
  let it = null;
  try { it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference,webUrl"); }
  catch (e) {
    if (!/\(404/.test(String(e.message))) throw e;
    const r = await fetchT("https://graph.microsoft.com/v1.0" + at + "/content?@microsoft.graph.conflictBehavior=fail", { method: "PUT",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: b64Bytes(ESC_TEMPLATE_B64) });
    if (r.ok) it = await r.json();
    else if (r.status === 409) it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference,webUrl");
    else throw new ApiError(502, "OneDrive did not create " + name + " (" + r.status + ").");
  }
  const loc = { driveId: it.parentReference.driveId, itemId: it.id, folderId: c.od_folder_id, name: it.name, path: [CLIENT_ROOT, odName(c.name), it.name].join(" › "),
    link: await odShareLink(tok, it.parentReference.driveId, it.id, it.webUrl) };
  await setSetting(env, key, loc);
  return loc;
}
/* The SLA copy: for Drishti's Escalations KPI (threshold 0: none in the month is green, one or more is red), each month's
   escalations also go to the client's SLA & KPI folder under each of its team leads, as
   Brahmastra Reports / <Team lead> / <Client> / SLA & KPI / Escalation Tracker - <Client> - Nov 2026.xlsx.
   Drishti counts every row of the file it is given, by department, so this file holds that month's external escalations only
   (the client's own; internal ones stay in the client's tracker file and are not in its SLA). */
const ESC_SLA_TARGET = 0;
const monthLabel = (ym) => MONTHS_LONG[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4);
// the month after / before a YYYY-MM
const nextMonthISO = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const prevMonthISO = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
async function escalationSlaFiles(env, tok, clientId, months) {
  const c = await one(env, "SELECT id, name FROM clients WHERE id = ?", clientId); if (!c) return [];
  const owner = encodeURIComponent(env.REPORTS_OWNER || REPORTS_OWNER_DEFAULT), saved = [];
  const leads = await clientTeamLeads(env, c.id, null);
  for (const ym of months) {
    // the client's own escalations only: internal ones are not in the client's SLA
    const rows = (await all(env, "SELECT * FROM escalations WHERE client_id = ? AND substr(day, 1, 7) = ? AND kind <> 'internal' ORDER BY sr", c.id, ym)).map((e) => escRow(e, c.name));
    const name = odName("Escalation Tracker - " + c.name + " - " + monthLabel(ym)) + ".xlsx";
    for (const lead of leads) {
      const path = [REPORTS_ROOT, odName(lead), odName(c.name), "SLA & KPI", name];
      const at = "/users/" + owner + "/drive/root:/" + path.map(encodeURIComponent).join("/") + ":";
      let it = null;
      try { it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference"); }
      catch (e) {
        if (!/\(404/.test(String(e.message))) throw e;
        const r = await fetchT("https://graph.microsoft.com/v1.0" + at + "/content?@microsoft.graph.conflictBehavior=fail", { method: "PUT",
          headers: { Authorization: "Bearer " + tok, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: b64Bytes(ESC_TEMPLATE_B64) });
        if (r.ok) it = await r.json();
        else if (r.status === 409) it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference");
        else throw new ApiError(502, "OneDrive did not create " + name + " (" + r.status + ").");
      }
      const base = `/drives/${encodeURIComponent(it.parentReference.driveId)}/items/${encodeURIComponent(it.id)}/workbook`;
      const sheets = await graphCall(tok, "GET", base + "/worksheets?$top=1&$select=id,name");
      const sheet = sheets.value && sheets.value[0]; if (!sheet) throw new ApiError(400, "The workbook has no worksheet.");
      const ws = base + "/worksheets/" + encodeURIComponent(sheet.id), last = colLetter(ESC_HEADER.length);
      // an escalation moved to another month leaves this file: clear the old rows before writing the month afresh
      await graphCall(tok, "POST", ws + `/range(address='A2:${last}5000')/clear`, { applyTo: "Contents" });
      await writeRange(tok, ws + `/range(address='A1:${last}${rows.length + 1}')`, [ESC_HEADER, ...rows], escFormats(rows.length));
      saved.push(path.join(" › "));
    }
  }
  return saved;
}
/* The TAT report for the SLA: after a month closes, each client's hand-offs that fell due in it, closed within TAT or not, go to
   the client's SLA & KPI folder under each of its team leads, as
   Brahmastra Reports / <Team lead> / <Client> / SLA & KPI / TAT Report - <Client> - Nov 2026.xlsx,
   next to the Escalation Tracker copy, for the Payment Posting TAT and Submission TAT on Drishti's scorecard. */
/* A hand-off still with its desk: pending, assigned, or waiting on the client (the TAT clock keeps running while it waits). */
const HO_OPEN = ["pending", "assigned", "client"];
const TAT_HEADER = ["Claim #", "Department", "Sent to the desk (IST)", "Due by (IST)", "Closed (IST)", "Within TAT", "Working hours taken", "TAT (working hours)"];
async function tatReportRows(env, clientId, ym) {
  const cl = await one(env, "SELECT id, name, posting_tat_hours, submission_tat_hours FROM clients WHERE id = ?", clientId); if (!cl) return { cl: null, rows: [] };
  const from = istDayStart(ym + "-01"), to = istDayStart(nextMonthISO(ym) + "-01") - 1, now = Date.now();
  const t = (ms) => { if (!ms) return ""; const d = new Date(ms + IST_MIN * 60000); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
  // every hand-off to Payment posting, Submission (each time a claim is sent, a resubmission too) and Rejections; the recheck
  // after submitting is the biller checking the payer has it, not Submission's work, so it is left out (as in tatStats)
  const rows = (await all(env, `SELECT h.dept, h.status, h.created_at, h.due_at, COALESCE(h.done_at, h.paused_at) AS closed_at, c.claim_no FROM handoffs h JOIN claims c ON c.id = h.claim_id
      WHERE h.client_id = ? AND h.dept IN ('posting','submission','rejection') AND h.due_at BETWEEN ? AND ? ORDER BY h.due_at LIMIT 20000`, clientId, from, to)).map((h) => {
    // waiting on the client keeps the clock running: still open (the README, and missedByClient, count it so)
    const open = HO_OPEN.includes(h.status), closed = open ? null : h.closed_at;
    const within = closed != null ? (closed <= h.due_at ? "Yes" : "No") : h.due_at < now ? "No" : "Open";
    return [h.claim_no || "", DEPT_LABEL[h.dept] || h.dept, t(h.created_at), t(h.due_at), t(closed), within, closed != null ? Math.round(workingHoursBetween(h.created_at, closed) * 10) / 10 : "",
      Math.round(workingHoursBetween(h.created_at, h.due_at))];
  });
  return { cl, rows };
}
async function tatSlaFiles(env, tok, clientId, ym) {
  const { cl, rows } = await tatReportRows(env, clientId, ym); if (!cl) return [];
  const owner = encodeURIComponent(env.REPORTS_OWNER || REPORTS_OWNER_DEFAULT), saved = [], name = odName("TAT Report - " + cl.name + " - " + monthLabel(ym)) + ".xlsx";
  for (const lead of await clientTeamLeads(env, cl.id, null)) {
    const path = [REPORTS_ROOT, odName(lead), odName(cl.name), "SLA & KPI", name];
    const at = "/users/" + owner + "/drive/root:/" + path.map(encodeURIComponent).join("/") + ":";
    let it = null;
    try { it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference"); }
    catch (e) {
      if (!/\(404/.test(String(e.message))) throw e;
      const r = await fetchT("https://graph.microsoft.com/v1.0" + at + "/content?@microsoft.graph.conflictBehavior=fail", { method: "PUT",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: b64Bytes(ESC_TEMPLATE_B64) });
      if (r.ok) it = await r.json();
      else if (r.status === 409) it = await graphCall(tok, "GET", at + "?$select=id,name,parentReference");
      else throw new ApiError(502, "OneDrive did not create " + name + " (" + r.status + ").");
    }
    const base = `/drives/${encodeURIComponent(it.parentReference.driveId)}/items/${encodeURIComponent(it.id)}/workbook`;
    const sheets = await graphCall(tok, "GET", base + "/worksheets?$top=1&$select=id,name");
    const sheet = sheets.value && sheets.value[0]; if (!sheet) throw new ApiError(400, "The workbook has no worksheet.");
    const ws = base + "/worksheets/" + encodeURIComponent(sheet.id), last = colLetter(TAT_HEADER.length);
    await graphCall(tok, "POST", ws + `/range(address='A2:${last}20000')/clear`, { applyTo: "Contents" });
    await writeRange(tok, ws + `/range(address='A1:${last}${rows.length + 1}')`, [TAT_HEADER, ...rows], [TAT_HEADER.map(() => "@"), ...rows.map(() => TAT_HEADER.map((h, i) => (i >= 6 ? "General" : "@")))]);
    saved.push(path.join(" › "));
  }
  return saved;
}
/* After a month closes: each active client's TAT report for it, once (a few clients per run). */
async function tatMonthFiles(env, now = Date.now()) {
  if (env.DEMO || !env.MS_CLIENT_SECRET || String(env.REPORTS_AUTO || "on").toLowerCase() === "off") return 0;
  const ym = prevMonthISO(istISO(now).slice(0, 7));
  const cls = await all(env, `SELECT id FROM clients WHERE active = 1 AND EXISTS (SELECT 1 FROM handoffs h WHERE h.client_id = clients.id AND h.dept IN ('posting','submission','rejection') AND h.due_at BETWEEN ? AND ?) ORDER BY name`,
    istDayStart(ym + "-01"), istDayStart(nextMonthISO(ym) + "-01") - 1);
  let done = 0, tok = null;
  for (const c of cls) {
    const key = "tatsla:" + c.id + ":" + ym, st = await getSetting(env, key, null);
    if (st && st.ok) continue;
    if (done >= 6) break;
    try { tok = tok || await graphAppToken(env); const files = await tatSlaFiles(env, tok, c.id, ym); await setSetting(env, key, { ok: true, at: Date.now(), files }); }
    catch (e) { await setSetting(env, key, { ok: false, at: Date.now(), error: str(String(e && e.message || e), 300) }); }
    done++;
  }
  return done;
}
/* Every active client's Escalation Tracker copy for Drishti exists for the month that just closed and for this month, even with no
   escalations (Drishti counts the rows: none is green). Made once each; a save keeps it current after that. A failure is tried
   again the next day. */
async function escMonthFiles(env, now = Date.now()) {
  if (env.DEMO || !env.MS_CLIENT_SECRET || String(env.REPORTS_AUTO || "on").toLowerCase() === "off") return 0;
  const cur = istISO(now).slice(0, 7), months = [prevMonthISO(cur), cur];
  let done = 0, tok = null;
  for (const c of await all(env, "SELECT id FROM clients WHERE active = 1 ORDER BY name")) for (const ym of months) {
    const key = "escsla:" + c.id + ":" + ym, st = await getSetting(env, key, null);
    if (st && (st.ok || now - (st.at || 0) < 86400000)) continue;
    if (done >= 6) return done;
    try { tok = tok || await graphAppToken(env); const files = await escalationSlaFiles(env, tok, c.id, [ym]); await setSetting(env, key, { ok: true, at: Date.now(), files }); }
    catch (e) { await setSetting(env, key, { ok: false, at: Date.now(), error: str(String(e && e.message || e), 300) }); }
    done++;
  }
  return done;
}
async function syncEscalations(env, clientId, months) {
  if (env.DEMO || !env.MS_CLIENT_SECRET || String(env.REPORTS_AUTO || "on").toLowerCase() === "off") return;
  const now = Date.now();
  try {
    const tok = await graphAppToken(env);
    try {
      const files = await escalationSlaFiles(env, tok, clientId, [...new Set((months || []).filter(Boolean))]);
      await recordWorkbookStatus(env, clientId + ":escsla", { ok: true, at: now, files });
    } catch (e) { await recordWorkbookStatus(env, clientId + ":escsla", { ok: false, at: now, error: String(e && e.message || e).slice(0, 300) }); }
    const loc = await escalationFile(env, tok, clientId);
    const cn = await one(env, "SELECT name FROM clients WHERE id = ?", clientId);
    const rows = (await all(env, "SELECT * FROM escalations WHERE client_id = ? ORDER BY sr", clientId)).map((e) => escRow(e, cn && cn.name));
    const base = `/drives/${encodeURIComponent(loc.driveId)}/items/${encodeURIComponent(loc.itemId)}/workbook`;
    const sheets = await graphCall(tok, "GET", base + "/worksheets?$top=1&$select=id,name");
    const sheet = sheets.value && sheets.value[0]; if (!sheet) throw new ApiError(400, "The workbook has no worksheet.");
    const all2 = [ESC_HEADER, ...rows];
    await writeRange(tok, base + "/worksheets/" + encodeURIComponent(sheet.id) + `/range(address='A1:${colLetter(ESC_HEADER.length)}${all2.length}')`, all2, escFormats(rows.length));
    await recordWorkbookStatus(env, clientId + ":esc", { ok: true, at: now, file: loc.path, link: loc.link || "", rows: rows.length });
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await recordWorkbookStatus(env, clientId + ":esc", { ok: false, at: now, error: msg });
    try { await folderTrouble(env, clientId, msg); } catch (x) {}
  }
}
/* The supervisors of a client's project, for escalation notices: its team leads from the Shastra roster. A client with no team
   lead: the admins, so a notice is never sent to nobody. */
async function escalationPeople(env, clientId) {
  const names = await clientTeamLeads(env, clientId, null);
  let people = await all(env, `SELECT id, name, email, email_missing FROM users WHERE active = 1 AND name IN (${names.map(() => "?").join(",") || "NULL"})`, ...names);
  if (!people.length) people = await all(env, "SELECT id, name, email, email_missing FROM users WHERE active = 1 AND role = 'admin'");
  return people;
}
/* A new escalation, or one marked as our error later: a notice in the bell and an email to the project's supervisors; the person who
   saved it gets a copy of the email (no bell notice: they know). The client, SR, type, department and dates, and who made the error:
   never the description or the client's email subject (they can carry patient details). */
async function escalationNotice(env, e, clientName, by, what, appUrl = "", defer = null) {
  const people = (await escalationPeople(env, e.client_id)).filter((u) => u.id !== by.id);
  const kind = ESC_KINDS[escKind(e)].toLowerCase(), now = Date.now();
  const err = e.is_error === "Y" ? ` Our error: made by ${e.error_by_name || "–"}, DOW ${e.error_dow ? mdy(e.error_dow) : "–"}.` : "";
  const text = (what === "error" ? `${by.name || "Someone"} marked ${kind} escalation SR${e.sr} (${e.dept}) at ${clientName} as our error.`
    : `${by.name || "Someone"} logged a new ${kind} escalation at ${clientName}: SR${e.sr}, ${e.dept}, received ${mdy(e.day)}.`) + err;
  const subject = what === "error" ? `Our error on escalation SR${e.sr}: ${clientName}` : `New ${kind} escalation SR${e.sr}: ${clientName} (${e.dept})`;
  const link = appUrl ? String(appUrl).replace(/\/+$/, "") + "/#/escalations?client_id=" + encodeURIComponent(e.client_id) : "";
  const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f1b24;max-width:600px;margin:0 auto;border:1px solid #dfe4ea;border-radius:10px;overflow:hidden;background:#ffffff">
<div style="background:#0b2740;color:#fff;padding:16px 22px"><div style="font-size:18px;font-weight:700">${htmlEsc(subject)}</div></div>
<div style="padding:16px 22px;font-size:14px;line-height:1.5"><p style="margin:0">${htmlEsc(text)}</p>` +
    (link ? `<p style="margin:16px 0 4px"><a href="${htmlEsc(link)}" style="display:inline-block;background:#17b39a;color:#ffffff;border-radius:7px;padding:9px 16px;font-weight:700;text-decoration:none">Open the Escalation tracker</a></p>` : "") +
    `<p style="font-size:12px;color:#627079;margin-top:14px">You get this as a supervisor on ${htmlEsc(clientName)}. The details are in the Escalation tracker: no description or patient details by email.</p></div></div>`;
  const mails = [];
  for (const u of people) {
    await run(env, "INSERT INTO user_notices (id, user_id, at, text, view, client_id, kind) VALUES (?,?,?,?,?,?,?)", uuid(), u.id, now, text.slice(0, 300), "escalations", e.client_id, "escalation");
    if (env.EMAIL_PROVIDER && u.email && !u.email_missing) mails.push({ to: u.email, subject, text: text + (link ? "\n\nOpen the Escalation tracker: " + link : ""), html });
  }
  // the copy for whoever saved it, so they have it in their mailbox too
  if (env.EMAIL_PROVIDER && by && by.email && !by.email_missing && !people.some((u) => u.email && u.email.toLowerCase() === String(by.email).toLowerCase())) {
    const copyNote = `You logged this escalation; this is your copy.${people.length ? " It also went to " + people.map((u) => u.name).join(", ") + "." : ""}`;
    mails.push({ to: by.email, subject: "Copy: " + subject, text: text + "\n\n" + copyNote + (link ? "\n\nOpen the Escalation tracker: " + link : ""),
      html: html.replace(/You get this as a supervisor on [^<]*\./, htmlEsc(copyNote)) });
  }
  // the emails after the save has answered (waitUntil), when the platform allows it
  const send = (async () => { for (const m of mails) { try { await sendEmail(env, m); } catch (x) {} } })();
  if (defer) defer(send); else await send;
  return people.length;
}
/* Open escalations past 24 hours with no reason yet: the client's team leads hear about it once, in the bell and by email. */
async function escalationReminders(env) {
  const now = Date.now();
  const rows = await all(env, `SELECT e.id, e.client_id, e.sr, e.dept, e.kind, cl.name AS client_name FROM escalations e JOIN clients cl ON cl.id = e.client_id
    WHERE e.status != 'resolved' AND e.delay_reason = '' AND e.reason_asked_at IS NULL AND e.created_at < ? LIMIT 50`, subWorkingHours(now, ESC_TAT_HOURS));
  for (const e of rows) {
    await run(env, "UPDATE escalations SET reason_asked_at = ? WHERE id = ?", now, e.id);
    const people = await escalationPeople(env, e.client_id);
    const text = `${ESC_KINDS[escKind(e)]} escalation SR${e.sr} (${e.dept}) at ${e.client_name} is still open after 24 working hours. Give the reason and the expected close date in the Escalation tracker.`;
    for (const u of people) {
      await run(env, "INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)", uuid(), u.id, now, text, "escalations", e.client_id);
      if (env.EMAIL_PROVIDER && u.email && !u.email_missing) { try { await sendEmail(env, { to: u.email, subject: `Escalation SR${e.sr} open over 24 working hours: ${e.client_name}`, text, html: `<p style="font:14px Segoe UI,Arial,sans-serif">${htmlEsc(text)}</p>` }); } catch (x) {} }
    }
  }
  return rows.length;
}
/* ---- TAT board: what is pending against each TAT, per client ----
   The desks (Payment posting, Submission with its rechecks, Rejections) against the client's TAT, and Needs attention (flagged by
   billers, sent back by the desks, client requests to send) against 48 hours: every TAT in working hours, Monday to Friday, IST.
   `late` lists the items past TAT for the reminders: claim numbers and names of the team only, never patient details or note text. */
const TAT_DEPTS = [["posting", "Payment posting"], ["submission", "Submission"], ["rejection", "Rejections"]];
const ATTN_PARTS = [["flagged", "Flagged by billers"], ["back", "Sent back by Posting / Submission"], ["requests", "Client requests to send"]];
/* "Can't close yet": a team lead gives the reason and the expected close date; until that date the task is on hold (amber), off
   the Past TAT reminders. Once the date passes it is back, marked as past the expected date. */
const TAT_HOLD_REASONS = ["Waiting on the payer", "Waiting on the client", "Waiting on a portal or the clearinghouse", "Waiting on another department", "Needs a manager's decision", "Other"];
/* ---------------------------------------------------------------- team tasks
   Needs attention › Team tasks: a team lead (SME and above) gives a task to one or more people on their team: the client (or
   none, an internal task), the scope, what to do, how many items, the TAT (24 or 72 working hours, another number of working
   hours, or a date) and files or screenshots. Each person gets their share with a notice; it shows on their My day and in My
   tasks. They update the count (In progress, Completed, Need help) with a comment and files, and the team lead gets a notice.
   Items done count toward the person's count on Dashboard › Team status. Emails carry no task text (only client, scope,
   counts and dates). */
const TASK_SCOPES = ["AR follow-up", "Payment posting", "Submission", "Rejections", "Eligibility (EV)", "Other"];
const TASK_SOURCES = ["Client", "Manager", "Internal"];
const TASK_MAX_FILES = 6;
const TASK_DESC_MAX = 4000, TASK_COMMENT_MAX = 2000;
// A team lead sees the tasks they gave and, with edit access to the client, the ones on their clients; admins and the VP all.
const taskLeadSees = (user, t) => !!user && user.role === "supervisor" && (t.created_by === user.id || !!user.is_admin || !!user.access_all || (!!t.client_id && leadFor(user, t.client_id)));
// "Nov 10, 7:00 AM" in IST, the way the page shows times
const istWhen = (ms) => { const d = new Date(ms + IST_MIN * 60000), h = d.getUTCHours(); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + ", " + ((h % 12) || 12) + ":" + String(d.getUTCMinutes()).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM"); };
/* The due time from the TAT picked: 24 or 72 working hours, any other number of working hours (1 to 480), or a date (the end of
   that day, IST). Working hours are Monday to Friday, Shastra holidays left out, the same clock as every other TAT. */
function taskDueFrom(now, tat) {
  const t = tat && typeof tat === "object" ? tat : {};
  if (t.kind === "date") {
    const d = isoDate(t.date); if (!d) throw bad("Pick the date it is due.");
    const today = istISO(now); if (d < today) throw bad("The due date is in the past: pick today or later.");
    if (d > istISO(now + 60 * 86400000)) throw bad("The due date can be at most 60 days ahead.");
    const due = istDayEnd(d); if (due <= now) throw bad("Pick a due date later today or after.");
    return { tat_hours: Math.max(0.1, Math.round(workingHoursBetween(now, due) * 10) / 10), due_at: due };
  }
  const h = t.kind === "72" ? 72 : t.kind === "24" ? 24 : Math.round(num(t.hours, 0) * 10) / 10;
  if (!(h >= 1 && h <= 480)) throw bad("Write the TAT in working hours: 1 to 480.");
  return { tat_hours: h, due_at: addWorkingHours(now, h) };
}
/* Files given with a task or an update: checked like a claim's attachments (8 MB each, a safe type to open or a plain download). */
function taskFilesIn(list) {
  const xs = Array.isArray(list) ? list : [];
  if (xs.length > TASK_MAX_FILES) throw bad("Up to " + TASK_MAX_FILES + " files at a time.");
  return xs.map((f) => {
    const name = str(f && f.name, 200).replace(/[\\/\u0000-\u001f]/g, "_").trim(); if (!name) throw bad("A file has no name.");
    const data = String((f && f.data) || ""); if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw bad("A file could not be read. Try adding it again.");
    const size = Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (size > ATTACH_MAX_BYTES) throw bad("Files can be up to " + ATTACH_MAX_BYTES / 1048576 + " MB.");
    const type0 = str(f && f.type, 120).trim().toLowerCase();
    const type = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain|text\/csv|application\/(vnd\.[a-z0-9.+-]+|msword|zip)|message\/rfc822)$/.test(type0) ? type0 : "application/octet-stream";
    return { name, type, size, data };
  });
}
async function saveTaskFiles(env, taskId, updateId, files, user, now) {
  for (const f of files) {
    const id = uuid(), parts = [];
    for (let i = 0; i < f.data.length; i += ATTACH_PART_CHARS) parts.push(f.data.slice(i, i + ATTACH_PART_CHARS));
    for (let i = 0; i < parts.length; i++) await run(env, "INSERT INTO attachment_parts (attachment_id, seq, data) VALUES (?,?,?)", id, i, parts[i]);
    await run(env, "INSERT INTO team_task_files (id, task_id, update_id, name, type, size, parts, user_id, user_name, at) VALUES (?,?,?,?,?,?,?,?,?,?)", id, taskId, updateId || null, f.name, f.type, f.size, parts.length, user.id, user.name || "", now);
  }
}
/* The rows a list shows: each task with its people (share, done, status), its files, how much is done, and its TAT state. */
async function shapeTasks(env, tasks, now) {
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id), people = new Map(), files = new Map(), last = new Map();
  for (const part of chunks(ids, 80)) {
    const q = part.map(() => "?").join(",");
    for (const p of await all(env, `SELECT p.*, u.name AS name FROM team_task_people p LEFT JOIN users u ON u.id = p.user_id WHERE p.task_id IN (${q}) ORDER BY u.name`, ...part)) {
      if (!people.has(p.task_id)) people.set(p.task_id, []);
      people.get(p.task_id).push({ id: p.id, user_id: p.user_id, name: p.name || "Someone", share: p.share, done: p.done_n, status: p.status, updated_at: p.updated_at || null, completed_at: p.completed_at || null, seen: !!p.seen_at });
    }
    // the files given with the task (the ones added with an update show in its history)
    for (const f of await all(env, `SELECT task_id, COUNT(*) AS n FROM team_task_files WHERE task_id IN (${q}) AND update_id IS NULL GROUP BY task_id`, ...part)) files.set(f.task_id, f.n);
    for (const u of await all(env, `SELECT task_id, user_name, done_n, status, comment, at, kind FROM team_task_updates WHERE task_id IN (${q}) AND kind = 'update' ORDER BY at`, ...part)) last.set(u.task_id, u);
  }
  const today = istISO(now), soon = addWorkingHours(now, DUE_SOON_HOURS);
  return tasks.map((t) => {
    const ps = people.get(t.id) || [], open = t.status === "open", held = open && !!t.hold_until && t.hold_until >= today;
    const done = ps.reduce((a, p) => a + (p.done || 0), 0), late = open && !held && now > t.due_at;
    const lu = last.get(t.id) || null;
    return { id: t.id, client_id: t.client_id || null, client_name: t.client_name || "", scope: t.scope, title: t.title, description: t.description, source: t.source,
      tat_hours: t.tat_hours, due_at: t.due_at, created_at: t.created_at, created_by: t.created_by, created_by_name: t.created_by_name, count: t.count_total, done,
      status: t.status, closed_at: t.closed_at || null, closed_by_name: t.closed_by_name || "", within_tat: t.closed_at ? t.closed_at <= t.due_at : null,
      hold: t.hold_until ? { reason: t.hold_reason, note: t.hold_note, until: t.hold_until, by: t.hold_by_name, active: held } : null,
      late, held, due_soon: open && !held && !late && t.due_at <= soon, help: open && ps.some((p) => p.status === "help"),
      left_wh: open ? Math.round((now <= t.due_at ? workingHoursBetween(now, t.due_at) : -workingHoursBetween(t.due_at, now)) * 10) / 10 : null,
      used_pct: open ? Math.max(0, Math.min(100, Math.round(100 * workingHoursBetween(t.created_at, now) / Math.max(0.1, workingHoursBetween(t.created_at, t.due_at))))) : 100,
      files: files.get(t.id) || 0, people: ps, last_update: lu ? { by: lu.user_name, done: lu.done_n, status: lu.status, comment: lu.comment, at: lu.at } : null,
      unseen_update: !!lu && (!t.lead_seen_at || lu.at > t.lead_seen_at), updated_at: t.updated_at };
  });
}
async function taskForLead(env, user, id) {
  const t = await one(env, "SELECT * FROM team_tasks WHERE id = ?", str(id, 60));
  if (!t) throw notFound("That task was not found.");
  if (!taskLeadSees(user, t)) throw denied("This task is not one of yours.");
  return t;
}
function blankTat() {
  const d = () => ({ n: 0, bal: 0, ok: 0, soon: 0, late: 0, hold: 0, rechecks: 0, oldest_late_h: 0 });
  return { desks: { posting: d(), submission: d(), rejection: d() }, attn: { flagged: { n: 0, late: 0 }, back: { n: 0, late: 0 }, requests: { n: 0, late: 0 }, n: 0, soon: 0, late: 0, hold: 0, oldest_late_h: 0 }, late: [], soon: [], held: [] };
}
/* The holds in force or past for these clients: kind + ref -> the latest one not cleared. */
async function tatHolds(env, ids) {
  if (!ids.length) return new Map();
  const rows = await all(env, `SELECT * FROM tat_holds WHERE cleared_at IS NULL AND client_id IN (${ids.map(() => "?").join(",")}) ORDER BY at`, ...ids);
  return new Map(rows.map((h) => [h.kind + ":" + h.ref_id, h]));
}
async function tatBoard(env, clientIds, now = Date.now()) {
  const ids = [...new Set(clientIds || [])].filter(Boolean);
  const per = new Map(ids.map((id) => [id, blankTat()]));
  if (!ids.length) return per;
  // due soon: within DUE_SOON_HOURS working hours (a task due Monday 02:00 is due soon on Friday 23:00)
  const IN = `(${ids.map(() => "?").join(",")})`, soonCut = addWorkingHours(now, DUE_SOON_HOURS), today = istISO(now);
  const holds = await tatHolds(env, ids);
  // a hold counts while its date has not passed; one whose date passed travels with the item as "past the expected date"
  const holdOf = (kind, ref, since) => { const h = holds.get(kind + ":" + ref); if (!h || (kind === "flag" && h.since && since && h.since !== since)) return { on: null, past: null };
    const x = { id: h.id, reason: h.reason, note: h.note, until: h.until, by: h.by_name, at: h.at }; return h.until >= today ? { on: x, past: null } : { on: null, past: x }; };
  // waiting on the client keeps the desk's TAT running, so it stays here (README: the clock keeps running)
  const desk = await all(env, `SELECT h.id, h.claim_id, h.client_id, h.dept, h.status, h.due_at, h.created_at, h.available_at, h.created_by_name, c.claim_no, c.balance, u.name AS with_name
    FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN users u ON u.id = COALESCE(h.assigned_to, h.lead_id)
    WHERE h.status IN ('pending','assigned','client') AND h.client_id IN ${IN} AND NOT (h.dept = 'subcheck' AND COALESCE(h.available_at, 0) > ?) ORDER BY h.due_at LIMIT 5000`, ...ids, now);
  for (const h of desk) {
    const t = per.get(h.client_id), k = h.dept === "subcheck" ? "submission" : h.dept, b = t && t.desks[k];
    if (!b) continue;
    b.n++; b.bal += Number(h.balance) || 0; if (h.dept === "subcheck") b.rechecks++;
    // a recheck waits from when it opened (48 working hours after the submission), not from the submission
    const st0 = h.dept === "subcheck" && h.available_at ? h.available_at : h.created_at, hd = holdOf("handoff", h.id), waited = workingHoursBetween(st0, now);
    const item = { group: "desks", dept: k, recheck: h.dept === "subcheck", ref_kind: "handoff", ref_id: h.id, claim_id: h.claim_id, claim_no: h.claim_no || "", at: st0, due: h.due_at,
      by: h.created_by_name || "", with: h.with_name || "", waited_h: Math.floor(waited), hold_past: hd.past, waiting_client: h.status === "client",
      tat: Math.round(workingHoursBetween(st0, h.due_at)) };
    if (hd.on) { b.hold++; t.held.push({ ...item, hold: hd.on }); }
    else if (h.due_at < now) { b.late++; b.oldest_late_h = Math.max(b.oldest_late_h, Math.floor(waited)); t.late.push({ ...item, over_h: Math.max(1, Math.ceil(workingHoursBetween(h.due_at, now))) }); }
    else if (h.due_at <= soonCut) { b.soon++; t.soon.push({ ...item, left_h: Math.round(workingHoursBetween(now, h.due_at) * 10) / 10 }); }
    else b.ok++;
  }
  const attnItem = (t, part, kind, ref, claimId, start, claimNo, by, extra) => {
    const a = t.attn, due = addWorkingHours(start || now, ATTN_TAT_HOURS), hd = holdOf(kind, ref, start), waited = workingHoursBetween(start, now);
    a[part].n++; a.n++;
    const item = { group: "ar", part, ref_kind: kind, ref_id: ref, claim_id: claimId, claim_no: claimNo || "", at: start, due, by: by || "", waited_h: Math.floor(waited), hold_past: hd.past, ...(extra || {}) };
    if (hd.on) { a.hold++; t.held.push({ ...item, hold: hd.on }); }
    else if (due < now) { a[part].late++; a.late++; a.oldest_late_h = Math.max(a.oldest_late_h, Math.floor(waited)); t.late.push({ ...item, over_h: Math.max(1, Math.ceil(workingHoursBetween(due, now))) }); }
    else if (due <= soonCut) { a.soon++; t.soon.push({ ...item, left_h: Math.round(workingHoursBetween(now, due) * 10) / 10 }); }
  };
  for (const r of await all(env, `SELECT c.id, c.client_id, c.claim_no, c.escalated_at, e.name AS by_name FROM claims c LEFT JOIN users e ON e.id = c.escalated_by
      WHERE c.escalated = 1 AND c.state IN ${ESCALATION_STATES} AND c.client_id IN ${IN} AND NOT ${BOUNCE_WAITING_SQL("c", now)} LIMIT 5000`, ...ids)) {
    const t = per.get(r.client_id); if (t) attnItem(t, "flagged", "flag", r.id, r.id, r.escalated_at || now, r.claim_no, r.by_name);
  }
  for (const r of await all(env, `SELECT h.id, h.claim_id, h.client_id, h.dept, COALESCE(h.paused_at, h.created_at) AS at, h.client_req_by_name AS by_name, c.claim_no FROM handoffs h JOIN claims c ON c.id = h.claim_id
      WHERE h.status = 'client' AND h.client_sent_at IS NULL AND h.client_id IN ${IN} LIMIT 5000`, ...ids)) {
    const t = per.get(r.client_id); if (t) attnItem(t, "requests", "handoff", r.id, r.claim_id, r.at, r.claim_no, r.by_name, { dept: r.dept });
  }
  // sent back by the desks: waiting until a team lead reviews it (or a biller works it, or it goes to a desk again)
  for (const r of await all(env, `SELECT h.id, h.claim_id, h.client_id, h.dept, h.done_at, h.done_by_name, c.claim_no FROM handoffs h JOIN claims c ON c.id = h.claim_id
      WHERE h.status IN ('assistance','back') AND h.done_at > ? AND h.client_id IN ${IN} AND NOT (c.reviewed_at IS NOT NULL AND c.reviewed_at > h.done_at)
        AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.claim_id = h.claim_id AND n.kind = 'work' AND n.created_at > h.done_at)
        AND NOT EXISTS (SELECT 1 FROM handoffs h2 WHERE h2.claim_id = h.claim_id AND h2.created_at > h.done_at) LIMIT 5000`, now - 30 * 86400000, ...ids)) {
    const t = per.get(r.client_id); if (t) attnItem(t, "back", "handoff", r.id, r.claim_id, r.done_at, r.claim_no, r.done_by_name, { dept: r.dept });
  }
  return per;
}
/* A third return to AR flags the claim (escalated_at = the return's time) and leaves the "sent back" task: the flag is not a
   second Needs attention item. */
const BOUNCE_FLAG_SQL = (c) => `EXISTS (SELECT 1 FROM handoffs hb WHERE hb.claim_id = ${c}.id AND hb.status IN ('assistance','back') AND hb.done_at = ${c}.escalated_at)`;
/* ...and it shows once: under Sent back while that return is still waiting there (not worked, nothing newer, under 30 days old),
   then under Flagged until a team lead reviews it. */
const BOUNCE_WAITING_SQL = (c, now = Date.now()) => `(${BOUNCE_FLAG_SQL(c)} AND ${c}.escalated_at > ${Math.floor(now - 30 * 86400000)}
  AND NOT EXISTS (SELECT 1 FROM notes nb WHERE nb.claim_id = ${c}.id AND nb.kind = 'work' AND nb.created_at > ${c}.escalated_at)
  AND NOT EXISTS (SELECT 1 FROM handoffs h2b WHERE h2b.claim_id = ${c}.id AND h2b.created_at > ${c}.escalated_at))`;
/* Several clients' boards added up (Inventory status for everyone). */
function sumTat(boards) {
  const o = blankTat(); delete o.late; delete o.soon; delete o.held;
  for (const t of boards) {
    for (const [k] of TAT_DEPTS) for (const f of ["n", "bal", "ok", "soon", "late", "hold", "rechecks"]) o.desks[k][f] += t.desks[k][f];
    for (const [k] of TAT_DEPTS) o.desks[k].oldest_late_h = Math.max(o.desks[k].oldest_late_h, t.desks[k].oldest_late_h);
    for (const [p] of ATTN_PARTS) { o.attn[p].n += t.attn[p].n; o.attn[p].late += t.attn[p].late; }
    for (const f of ["n", "soon", "late", "hold"]) o.attn[f] += t.attn[f];
    o.attn.oldest_late_h = Math.max(o.attn.oldest_late_h, t.attn.oldest_late_h);
  }
  return o;
}
/* How much was closed within TAT in a window (the month on the SLA scorecard, last week in the Monday digest): the tasks that
   fell due in it. Payment posting; Submission: every time a claim is sent to it (a first submission or a resubmission, each
   counts) and Rejections (they resubmit to the Submission TAT), but not the recheck after submitting (the biller checking
   the payer has the claim); Needs attention (48 working hours).
   Closed after the due time, or still open past it, is missed; still open and not yet due is counted as open (left out of the %). */
async function tatStats(env, clientIds, from, to, now = Date.now()) {
  const ids = [...new Set(clientIds || [])].filter(Boolean);
  const blank = () => ({ due: 0, met: 0, missed: 0, open: 0, pct: null, who: {} });
  const out = new Map(ids.map((id) => [id, { posting: blank(), submission: blank(), attention: blank(), missed_list: [] }]));
  if (!ids.length) return out;
  // every task due in the window, also the ones not due yet (a month still running): tally() counts those as open
  const IN = `(${ids.map(() => "?").join(",")})`;
  const tally = (s, due, closed, who, row) => {
    if (closed == null && due >= now) { s.open++; return; }
    s.due++;
    if (closed != null && closed <= due) s.met++;
    else { s.missed++; if (who) s.who[who] = (s.who[who] || 0) + 1; if (row) row(); }
  };
  for (const h of await all(env, `SELECT h.client_id, h.dept, h.status, h.due_at, h.created_at, COALESCE(h.done_at, h.paused_at) AS closed_at, c.claim_no, COALESCE(NULLIF(h.done_by_name, ''), u.name) AS who
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN users u ON u.id = COALESCE(h.assigned_to, h.lead_id)
      WHERE h.dept IN ('posting','submission','rejection') AND h.client_id IN ${IN} AND h.due_at BETWEEN ? AND ? LIMIT 20000`, ...ids, from, to)) {
    const o = out.get(h.client_id); if (!o) continue;
    const k = h.dept === "posting" ? "posting" : "submission", open = HO_OPEN.includes(h.status);
    tally(o[k], h.due_at, open ? null : h.closed_at, h.who || "", () => o.missed_list.push({ dept: k, claim_no: h.claim_no || "", sent: h.created_at, due: h.due_at, closed: open ? null : h.closed_at, who: h.who || "" }));
  }
  // Needs attention: flagged by billers (closed when answered or reviewed), sent back (when reviewed or worked again), client requests (when sent)
  const attn = async (sql, args) => { for (const r of await all(env, sql, ...args)) { const o = out.get(r.client_id); if (!o || !r.start) continue; const due = addWorkingHours(r.start, ATTN_TAT_HOURS); if (due < from || due > to) continue; tally(o.attention, due, r.closed_at || null, ""); } };
  const back = now - 120 * 86400000;
  await attn(`SELECT client_id, escalated_at AS start, CASE WHEN escalated = 1 THEN NULL ELSE COALESCE(escalation_answered_at, reviewed_at, updated_at) END AS closed_at FROM claims c
    WHERE client_id IN ${IN} AND escalated_at > ? AND (escalated = 1 OR escalation_answered_at >= escalated_at OR reviewed_at >= escalated_at) AND NOT ${BOUNCE_FLAG_SQL("c")}`, [...ids, back]);
  // the first of: reviewed by a team lead, worked by a biller, sent to a desk again (none yet: still open)
  await attn(`SELECT h.client_id, h.done_at AS start, NULLIF(MIN(COALESCE(CASE WHEN c.reviewed_at > h.done_at THEN c.reviewed_at END, 9e15),
        COALESCE((SELECT MIN(n.created_at) FROM notes n WHERE n.claim_id = h.claim_id AND n.kind = 'work' AND n.created_at > h.done_at), 9e15),
        COALESCE((SELECT MIN(h2.created_at) FROM handoffs h2 WHERE h2.claim_id = h.claim_id AND h2.created_at > h.done_at), 9e15)), 9e15) AS closed_at
    FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.status IN ('assistance','back') AND h.client_id IN ${IN} AND h.done_at > ?`, [...ids, back]);
  await attn(`SELECT client_id, COALESCE(paused_at, created_at) AS start, COALESCE(client_sent_at, client_answered_at) AS closed_at FROM handoffs WHERE client_req_by_name <> '' AND client_id IN ${IN} AND COALESCE(paused_at, created_at) > ?`, [...ids, back]);
  for (const o of out.values()) for (const k of ["posting", "submission", "attention"]) { const s = o[k]; s.pct = s.due ? Math.round(s.met / s.due * 1000) / 10 : null; }
  return out;
}
/* ---- Repeat denials and payer tips: learned from the team's own work entries ----
   A denial is a work entry with status Claim Denied or Claim Rejected; its reason is the SAAG sub-status. What worked is the SAAG
   action taken on a denial that was followed by a payment on the same claim, with no new denial for the same reason in between.
   Only SAAG statuses and actions are used (a fixed list): never the free-text findings of another claim. */
const DENIED_SQL = "COALESCE(NULLIF(n.status, ''), n.status_code) IN ('Claim Denied', 'Claim Rejected')";
const PAID_SQL = "COALESCE(NULLIF(n.status, ''), n.status_code) IN ('Claim Paid', 'Partially Paid')";
const reasonKey = (r) => String(r || "Other").trim().toLowerCase().replace(/\s+/g, " ");
/* Every denial and payment entry of these clients in the last year, per claim in time order. */
async function denialHistory(env, clientIds, payer = null) {
  const ids = [...new Set(clientIds || [])].filter(Boolean); if (!ids.length) return [];
  return await all(env, `SELECT n.claim_id, n.created_at, n.action, n.sub_status, COALESCE(NULLIF(n.status, ''), n.status_code) AS status, c.client_id, c.payer
    FROM notes n JOIN claims c ON c.id = n.claim_id
    WHERE n.kind = 'work' AND c.client_id IN (${ids.map(() => "?").join(",")})${payer != null ? " AND c.payer = ?" : ""} AND n.created_at > ? AND (${DENIED_SQL} OR ${PAID_SQL})
    ORDER BY n.claim_id, n.created_at LIMIT 50000`, ...ids, ...(payer != null ? [payer] : []), Date.now() - 365 * 86400000);
}
/* What worked for a denial reason: per (client, payer, reason) and per (client, reason), each action tried and how often a payment followed. */
function whatWorked(rows) {
  const tally = new Map(), add = (k, action, paid) => { if (!action) return; const m = tally.get(k) || new Map(); const t = m.get(action) || { action, tried: 0, paid: 0 }; t.tried++; if (paid) t.paid++; m.set(action, t); tally.set(k, m); };
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i]; if (d.status !== "Claim Denied" && d.status !== "Claim Rejected") continue;
    const rk = reasonKey(d.sub_status); let paid = false;
    for (let j = i + 1; j < rows.length && rows[j].claim_id === d.claim_id; j++) {
      const x = rows[j];
      if (x.status === "Claim Paid" || x.status === "Partially Paid") { paid = true; break; }
      if (reasonKey(x.sub_status) === rk) break; // denied again for the same reason: this action did not work
    }
    add(d.client_id + "|" + d.payer + "|" + rk, d.action, paid); add(d.client_id + "||" + rk, d.action, paid);
  }
  const best = (k) => { const m = tally.get(k); if (!m) return []; return [...m.values()].filter((t) => t.paid > 0).sort((a, b) => b.paid - a.paid || b.paid / b.tried - a.paid / a.tried).slice(0, 3); };
  return (clientId, payer, reason) => { const rk = reasonKey(reason), own = best(clientId + "|" + payer + "|" + rk); return own.length ? { any_payer: false, top: own } : { any_payer: true, top: best(clientId + "||" + rk) }; };
}
/* "Denied again": a denial counts once per trip to the payer. A new denial for the same reason counts again only after the claim
   went back to the payer (an entry that resubmits, reprocesses or appeals it, or an entry that is not a denial, such as in
   process), and not at all once a payment is entered after it. Two follow-up entries on one open denial are one denial.
   rows: one claim's work entries in time order. Gives { reasonKey: { reason, times, last_at } } for reasons still unpaid. */
const RESENT_ACTION = /resubmi|reprocess|appeal|paper claim|reconsider|recon\//i;
function denialEpisodes(rows) {
  const by = new Map(); let sent = true;
  for (const r of rows) {
    const isDen = r.status === "Claim Denied" || r.status === "Claim Rejected";
    if (r.status === "Claim Paid" || r.status === "Partially Paid") { by.clear(); sent = true; continue; }
    if (isDen) {
      const k = reasonKey(r.sub_status), e = by.get(k) || { reason: r.sub_status || "Other", times: 0, last_at: 0 };
      if (sent || !e.times) e.times++;
      e.last_at = r.created_at; e.reason = r.sub_status || e.reason; by.set(k, e);
      sent = RESENT_ACTION.test(r.action || "");
    } else sent = true;
  }
  return by;
}
async function repeatDenialClaims(env, ids, now = Date.now()) {
  if (!ids.length) return [];
  const IN = `(${ids.map(() => "?").join(",")})`;
  // claims still being worked with 2 or more denial entries in the year, then every work entry of those claims in time order
  const cand = await all(env, `SELECT n.claim_id FROM notes n JOIN claims c ON c.id = n.claim_id
      WHERE n.kind = 'work' AND ${DENIED_SQL} AND c.client_id IN ${IN} AND c.state IN ('open','assigned','in_progress','completed','in_process') AND n.created_at > ?
      GROUP BY n.claim_id HAVING COUNT(*) >= 2 LIMIT 2000`, ...ids, now - 365 * 86400000);
  const out = [];
  for (const part of chunks(cand.map((r) => r.claim_id), 80)) {
    const rows = await all(env, `SELECT n.claim_id, n.created_at, n.action, n.sub_status, COALESCE(NULLIF(n.status, ''), n.status_code) AS status FROM notes n
        WHERE n.kind = 'work' AND n.claim_id IN (${part.map(() => "?").join(",")}) AND n.created_at > ? ORDER BY n.claim_id, n.created_at`, ...part, now - 365 * 86400000);
    for (let i = 0; i < rows.length;) {
      let j = i; while (j < rows.length && rows[j].claim_id === rows[i].claim_id) j++;
      for (const e of denialEpisodes(rows.slice(i, j)).values()) if (e.times >= 2) out.push({ claim_id: rows[i].claim_id, reason: e.reason, times: e.times, last_at: e.last_at });
      i = j;
    }
  }
  return out;
}
async function repeatDenials(env, clientIds, now = Date.now()) {
  const ids = [...new Set(clientIds || [])].filter(Boolean); if (!ids.length) return { claims: [], patterns: [] };
  const IN = `(${ids.map(() => "?").join(",")})`;
  const worked = whatWorked(await denialHistory(env, ids));
  // the same claim denied again for the same reason, still being worked and not paid since
  const reps = (await repeatDenialClaims(env, ids, now)).sort((a, b) => b.last_at - a.last_at).slice(0, 500);
  const info = new Map();
  for (const part of chunks([...new Set(reps.map((r) => r.claim_id))], 80))
    for (const r of await all(env, `SELECT c.id, c.client_id, cl.name AS client_name, c.claim_no, c.payer, c.balance, c.state, u.name AS biller,
          (SELECT n2.action FROM notes n2 WHERE n2.claim_id = c.id AND n2.kind = 'work' ORDER BY n2.created_at DESC LIMIT 1) AS last_action
        FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id IN (${part.map(() => "?").join(",")})`, ...part)) info.set(r.id, r);
  const claims = reps.filter((r) => info.has(r.claim_id)).map((r) => { const c = info.get(r.claim_id); return { claim_id: r.claim_id, client_id: c.client_id, client_name: c.client_name, claim_no: c.claim_no, payer: c.payer,
    balance: c.balance, state: c.state, biller: c.biller, reason: r.reason, times: r.times, last_at: r.last_at, last_action: c.last_action, worked: worked(c.client_id, c.payer, r.reason) }; });
  // the same payer and reason on 3 or more claims in 30 days: something to fix at the source (a setup, a code, a payer rule)
  const patterns = (await all(env, `SELECT client_id, client_name, payer, MAX(reason) AS reason, COUNT(*) AS claims, COALESCE(SUM(balance), 0) AS bal, MAX(last_at) AS last_at FROM (
        SELECT c.client_id, cl.name AS client_name, c.payer, n.claim_id, c.balance, MAX(COALESCE(NULLIF(n.sub_status, ''), 'Other')) AS reason, LOWER(TRIM(COALESCE(NULLIF(n.sub_status, ''), 'Other'))) AS rk, MAX(n.created_at) AS last_at
        FROM notes n JOIN claims c ON c.id = n.claim_id LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE n.kind = 'work' AND ${DENIED_SQL} AND c.client_id IN ${IN} AND n.created_at > ? GROUP BY c.client_id, c.payer, n.claim_id, rk)
      GROUP BY client_id, payer, rk HAVING COUNT(*) >= 3 ORDER BY claims DESC, bal DESC LIMIT 200`, ...ids, now - 30 * 86400000))
    .map((r) => ({ ...r, worked: worked(r.client_id, r.payer, r.reason) }));
  return { claims, patterns };
}
/* Payer tips for one claim: how long this payer usually takes to pay after an action, what worked for this status, and a follow-up
   date to suggest. From the client's own entries at this payer in the last year; nothing shows on fewer than 3 cases. */
async function payerTips(env, c, { status, sub_status, action } = {}, now = Date.now()) {
  const rows = await all(env, `SELECT n.claim_id, n.created_at, n.action, n.sub_status, COALESCE(NULLIF(n.status, ''), n.status_code) AS status
    FROM notes n JOIN claims c ON c.id = n.claim_id WHERE n.kind = 'work' AND c.client_id = ? AND c.payer = ? AND n.created_at > ? ORDER BY n.claim_id, n.created_at LIMIT 30000`,
    c.client_id, c.payer || "", now - 365 * 86400000);
  const st = status || c.last_status_code || "", act = action || c.last_action_code || "", sub = sub_status || (status ? "" : c.last_sub_status || "");
  const isPaid = (x) => x.status === "Claim Paid" || x.status === "Partially Paid";
  // days from an entry with this action to the payment that followed on the same claim
  // one data point per claim: from the last entry with this action to the payment that followed it (a denial in between starts over)
  const days = [];
  for (let i = 0; i < rows.length;) {
    let j = i; while (j < rows.length && rows[j].claim_id === rows[i].claim_id) j++;
    let start = -1;
    for (let k = i; k < j; k++) {
      const r = rows[k];
      if (isPaid(r)) { if (start >= 0) { days.push((r.created_at - rows[start].created_at) / 86400000); break; } continue; }
      if (r.status === "Claim Denied" || r.status === "Claim Rejected") start = -1; // denied again: the payment came from a later action
      if (act && r.action === act) start = k;
    }
    i = j;
  }
  days.sort((a, b) => a - b);
  const dn = days.length, mid = dn % 2 ? days[(dn - 1) / 2] : (days[dn / 2 - 1] + days[dn / 2]) / 2;
  const median = dn >= 3 ? Math.max(1, Math.round(mid)) : null;
  // what worked for this status (and reason): the action on such an entry, and whether a payment followed
  const sk = reasonKey(sub), tally = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (!st || r.status !== st || (sub && reasonKey(r.sub_status) !== sk) || !r.action) continue;
    let paid = false; for (let j = i + 1; j < rows.length && rows[j].claim_id === r.claim_id; j++) { if (isPaid(rows[j])) { paid = true; break; } if (rows[j].status === r.status && reasonKey(rows[j].sub_status) === reasonKey(r.sub_status)) break; }
    const t = tally.get(r.action) || { action: r.action, tried: 0, paid: 0 }; t.tried++; if (paid) t.paid++; tally.set(r.action, t);
  }
  const top = [...tally.values()].filter((t) => t.paid > 0 && t.tried >= 2).sort((a, b) => b.paid - a.paid || b.paid / b.tried - a.paid / a.tried).slice(0, 3);
  const claims = new Set(rows.map((r) => r.claim_id)).size;
  const fu = median ? workingDayOnOrAfter(istISO(now + Math.min(45, Math.max(3, median)) * 86400000)) : null;
  // this claim: denied again for the same reason?
  const mine = rows.filter((r) => r.claim_id === c.id), lastDen = [...mine].reverse().find((r) => r.status === "Claim Denied" || r.status === "Claim Rejected");
  const ep = lastDen ? denialEpisodes(mine).get(reasonKey(lastDen.sub_status)) : null;
  return { payer: c.payer || "", claims, status: st, sub_status: sub, action: act, pay_days: median, pay_n: dn, worked: top, follow_up: fu,
    repeat: ep && ep.times >= 2 ? { reason: ep.reason || "Other", times: ep.times } : null };
}
/* ---- TAT reminders by email: every supervisor, SME and above on the client, Monday to Friday.
   Posting, Submission and Rejections at 09:00 IST; AR (Needs attention) at 19:00 IST. A send that fails is tried again on the
   hourly runs for the next 3 hours; nobody gets the same reminder twice in a day. */
const TAT_MAIL = { desks: { hour: 9, title: "Payment posting, Submission and Rejections", view: "handoffs" }, ar: { hour: 19, title: "Needs attention (AR)", view: "attention" } };
function tatMailDue(now) {
  const d = new Date(now + IST_MIN * 60000), dow = d.getUTCDay(), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (dow === 0 || dow === 6 || HOLIDAYS.has(istISO(now))) return null;   // weekends and Shastra holidays: the clock is stopped
  for (const [k, m] of Object.entries(TAT_MAIL)) if (h >= m.hour && h < m.hour + 3) return k;
  return null;
}
/* The team tasks past the TAT (not on hold), for the 19:00 email of the team lead who gave each: client, scope, counts, due time and
   who has it. Never the task's name or description. */
async function lateTeamTasks(env, now) {
  const today = istISO(now);
  const ts = (await all(env, "SELECT t.id, t.client_id, t.scope, t.created_by, t.due_at, t.hold_until, t.count_total, cl.name AS client_name FROM team_tasks t LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.status = 'open' AND t.due_at < ? LIMIT 2000", now))
    .filter((t) => !(t.hold_until && t.hold_until >= today));
  const people = new Map();
  for (const part of chunks(ts.map((t) => t.id), 80)) for (const p of await all(env, `SELECT p.task_id, p.done_n, u.name FROM team_task_people p LEFT JOIN users u ON u.id = p.user_id WHERE p.task_id IN (${part.map(() => "?").join(",")})`, ...part)) {
    if (!people.has(p.task_id)) people.set(p.task_id, []); people.get(p.task_id).push(p);
  }
  return ts.map((t) => { const ps = people.get(t.id) || []; return { created_by: t.created_by, client_name: t.client_name || "Internal", scope: t.scope, count: t.count_total, done: ps.reduce((a, p) => a + (p.done_n || 0), 0),
    due_at: t.due_at, over_h: Math.max(1, Math.ceil(workingHoursBetween(t.due_at, now))), with: ps.map((p) => p.name || "someone").join(", ") }; });
}
/* One person's reminder: their clients' items past TAT of this kind, grouped by client and type, and at 19:00 the team tasks
   they gave that are past the TAT. null when nothing is late. */
function tatMailFor(u, kind, clients, board, now, appUrl = "", tasks = []) {
  const groups = [];
  // a Payment posting / Submission person (team leads too) hears about their own desk only: not AR's Needs attention, not another desk
  const dd = deskDepts(u);
  for (const c of clients) {
    if (!onClient(u, c.id) || (dd && kind !== "desks")) continue;
    const t = board.get(c.id); if (!t) continue;
    const late = t.late.filter((x) => x.group === kind && (!dd || dd.includes(x.dept)));
    if (!late.length) continue;
    // the TAT each task was given (its due time came from it), not the client's TAT now: one number when the tasks agree, else each row's own
    if (kind === "desks") for (const [k, label] of TAT_DEPTS) { const xs = late.filter((x) => x.dept === k); if (xs.length) { const ts = [...new Set(xs.map((x) => x.tat))]; groups.push({ c, label, tat: ts.length === 1 ? ts[0] : null, xs }); } }
    else for (const [p, label] of ATTN_PARTS) { const xs = late.filter((x) => x.part === p); if (xs.length) groups.push({ c, label: "Needs attention · " + label, tat: ATTN_TAT_HOURS, xs }); }
  }
  const tks = kind === "ar" ? (tasks || []) : [];
  if (!groups.length && !tks.length) return null;
  const n = groups.reduce((t, g) => t + g.xs.length, 0) + tks.length;
  const when = new Date(now + IST_MIN * 60000), dt = when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) + ", " + String(when.getUTCHours()).padStart(2, "0") + ":" + String(when.getUTCMinutes()).padStart(2, "0") + " IST";
  const subject = `${n} ${n === 1 ? "task" : "tasks"} past TAT on your clients · ${TAT_MAIL[kind].title} · ${dt}`;
  const fmtAt = (ms) => { const d = new Date(ms + IST_MIN * 60000); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + ", " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
  const passed = (x) => (x.hold_past ? " · expected " + x.hold_past.until + " (" + x.hold_past.reason.toLowerCase() + "): the date has passed" : "");
  const who = (x) => (kind === "desks" ? (x.recheck ? "Recheck · " : "") + (x.by ? "Sent by " + x.by + " · " : "") + fmtAt(x.at) : (x.part === "flagged" ? "Flagged by " : x.part === "back" ? "Sent back by " : "Asked by ") + (x.by || "the team") + " · " + fmtAt(x.at)) + passed(x);
  const th = "text-align:left;font-size:11px;letter-spacing:.05em;color:#627079;padding:6px;border-bottom:1px solid #dfe4ea;text-transform:uppercase";
  const td = "padding:7px 6px;border-bottom:1px solid #f0f2f5;font-size:13px;vertical-align:top";
  const link = appUrl ? String(appUrl).replace(/\/+$/, "") + "/#/dashboard?tab=inventory" : "";
  const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f1b24;max-width:640px;margin:0 auto;border:1px solid #dfe4ea;border-radius:10px;overflow:hidden;background:#ffffff">
<div style="background:#0b2740;color:#fff;padding:16px 22px"><div style="font-size:18px;font-weight:700">${n} ${n === 1 ? "task is" : "tasks are"} past ${n === 1 ? "its" : "their"} TAT</div>
<div style="color:#bcd0e2;font-size:13px;margin-top:3px">${htmlEsc(TAT_MAIL[kind].title)} · every supervisor, SME and above on these clients gets this until they are closed.</div></div>
<div style="padding:16px 22px">` + groups.map((g) => `<div style="font-weight:700;font-size:13px;margin-top:10px">${htmlEsc(g.c.name)} · ${htmlEsc(g.label)} · ${g.tat != null ? "TAT " + g.tat + " working hour" + (g.tat === 1 ? "" : "s") : "each claim's own TAT"}</div>
<table style="width:100%;border-collapse:collapse;margin:6px 0 10px"><tr><th style="${th}">Claim #</th><th style="${th}">${kind === "desks" ? "Sent" : "What"}</th><th style="${th}">Waiting</th>${kind === "desks" ? `<th style="${th}">With</th>` : ""}</tr>` +
    g.xs.map((x) => `<tr><td style="${td};white-space:nowrap">${htmlEsc(x.claim_no || "–")}</td><td style="${td}">${htmlEsc(who(x))}</td><td style="${td};color:#ba2340;white-space:nowrap"><b>${x.waited_h} h</b> (${x.over_h} h over${g.tat == null ? ", TAT " + x.tat + " h" : ""})</td>${kind === "desks" ? `<td style="${td}">${htmlEsc(x.with || "–")}</td>` : ""}</tr>`).join("") + "</table>").join("") +
    (tks.length ? `<div style="font-weight:700;font-size:13px;margin-top:10px">Team tasks you gave · past the TAT</div>
<table style="width:100%;border-collapse:collapse;margin:6px 0 10px"><tr><th style="${th}">Client · scope</th><th style="${th}">Done</th><th style="${th}">Due</th><th style="${th}">With</th></tr>` +
      tks.map((x) => `<tr><td style="${td}">${htmlEsc(x.client_name)} · ${htmlEsc(x.scope)}</td><td style="${td};white-space:nowrap">${x.done} of ${x.count}</td><td style="${td};color:#ba2340;white-space:nowrap"><b>${htmlEsc(fmtAt(x.due_at))}</b> (${x.over_h} h over)</td><td style="${td}">${htmlEsc(x.with)}</td></tr>`).join("") + `</table>` : "") +
    (link ? `<p style="margin:16px 0 4px"><a href="${htmlEsc(link)}" style="display:inline-block;background:#17b39a;color:#ffffff;border-radius:7px;padding:9px 16px;font-weight:700;text-decoration:none">Open Brahmastra</a></p>` : "") +
    `<p style="font-size:12px;color:#627079;margin-top:14px">Working hours: Monday to Friday, Shastra holidays left out. Claim numbers only: no patient details and no note text. You get this because you are a supervisor, SME or above on these clients.</p></div></div>`;
  const text = `${n} ${n === 1 ? "task is" : "tasks are"} past TAT (${TAT_MAIL[kind].title}).\n\n` + groups.map((g) => `${g.c.name} · ${g.label} · ${g.tat != null ? "TAT " + g.tat + " working hour" + (g.tat === 1 ? "" : "s") : "each claim's own TAT"}\n` + g.xs.map((x) => `  ${x.claim_no || "–"} · ${who(x)} · waiting ${x.waited_h} h (${x.over_h} h over${g.tat == null ? ", TAT " + x.tat + " h" : ""})${x.with ? " · with " + x.with : ""}`).join("\n")).join("\n\n")
    + (tks.length ? (groups.length ? "\n\n" : "") + "Team tasks you gave · past the TAT\n" + tks.map((x) => `  ${x.client_name} · ${x.scope} · ${x.done} of ${x.count} done · due ${fmtAt(x.due_at)} (${x.over_h} h over) · with ${x.with}`).join("\n") : "")
    + (link ? "\n\nOpen Brahmastra: " + link : "") + "\n\nWorking hours: Monday to Friday.";
  return { subject, html, text, n };
}
async function sendTatReminders(env, { now = Date.now(), kind = null } = {}) {
  kind = kind || tatMailDue(now);
  if (!kind) return { kind: null, sent: 0, failed: 0 };
  const day = istISO(now);
  const clients = await all(env, "SELECT id, name, posting_tat_hours, submission_tat_hours FROM clients WHERE active = 1 ORDER BY name");
  const board = await tatBoard(env, clients.map((c) => c.id), now);
  const lateTasks = kind === "ar" ? await lateTeamTasks(env, now) : [];
  let sent = 0, failed = 0, people = 0;
  for (const u of await digestPeople(env)) {
    const mail = tatMailFor(u, kind, clients, board, now, env.APP_URL, lateTasks.filter((t) => t.created_by === u.id));
    if (!mail) continue;
    people++;
    // claim the send first (ok = 2), so two runs at once never both send it; a claim left by a run that died is taken over after 30 minutes
    const t0 = Date.now();
    const claim = await run(env, `INSERT INTO tat_mail_log (day, kind, user_id, email, at, ok, error, items) VALUES (?,?,?,?,?,2,'',?)
      ON CONFLICT (day, kind, user_id) DO UPDATE SET at = excluded.at, ok = 2, error = '', items = excluded.items WHERE tat_mail_log.ok = 0 OR (tat_mail_log.ok = 2 AND tat_mail_log.at < ?)`,
      day, kind, u.id, u.email, t0, mail.n, t0 - 30 * 60000);
    if (!changesOf(claim)) continue;
    let err = "";
    try { await sendEmail(env, { to: u.email, subject: mail.subject, text: mail.text, html: mail.html }); sent++; } catch (e) { err = str((e && e.message) || e, 300); failed++; }
    await run(env, "UPDATE tat_mail_log SET at = ?, ok = ?, error = ? WHERE day = ? AND kind = ? AND user_id = ?", Date.now(), err ? 0 : 1, err, day, kind, u.id);
  }
  return { kind, day, people, sent, failed };
}
/* Workforce Management from Purview Shastra: each project's Billable (what the manager set in WFM) and Assigned FTE, worked
   out the way WFM's Explore does (working agents split evenly across their projects, a fresher counting half), plus everyone on
   it. Read with the roster key from brahmastra_wfm (dev/shastra-wfm-feed.sql, run once in Shastra). Until that is run, the
   numbers just do not show. */
async function syncWfm(env) {
  const base = String(env.SHASTRA_URL || SHASTRA_URL_DEFAULT).replace(/\/+$/, ""), pub = env.SHASTRA_PUBLIC_KEY || SHASTRA_PUBLIC_KEY_DEFAULT;
  let r = null, data = null;
  try { r = await fetchT(base + "/rest/v1/rpc/brahmastra_wfm", { method: "POST", headers: { apikey: pub, Authorization: "Bearer " + pub, "Content-Type": "application/json" }, body: JSON.stringify({ p_key: env.SHASTRA_FEED_KEY }) }); data = await r.json(); } catch (e) {}
  if (!r || !r.ok || !data || data.ok === false || !Array.isArray(data.projects)) {
    const prev = await getSetting(env, "wfm_projects", null);
    const why = (data && (data.error || data.message)) || (r && r.ok && data ? "the answer has no list of projects" : r ? "HTTP " + r.status : "no answer");
    await setSetting(env, "wfm_projects", { ...(prev || {}), ok: false, tried_at: Date.now(), error: str(why, 200) });
    return null;
  }
  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const rows = data.projects.filter((x) => x && x.name).map((x) => ({ name: str(x.name, 120), billable: n(x.billable), assigned_fte: n(x.assigned_fte) || 0, agents: n(x.agents) || 0,
    training: n(x.training) || 0, team_fte: n(x.team_fte) || 0, people: n(x.people) || 0 }));
  await setSetting(env, "wfm_projects", { ok: true, at: Date.now(), today: data.today || "", rows });
  return rows;
}
/* Company holidays from Purview Shastra (dev/shastra-holidays-feed.sql): the TAT clock skips them. Until the function is
   there, the last list stays (none at first: Saturday and Sunday only). */
async function syncHolidays(env) {
  const base = String(env.SHASTRA_URL || SHASTRA_URL_DEFAULT).replace(/\/+$/, ""), pub = env.SHASTRA_PUBLIC_KEY || SHASTRA_PUBLIC_KEY_DEFAULT;
  let r = null, data = null;
  try { r = await fetchT(base + "/rest/v1/rpc/brahmastra_holidays", { method: "POST", headers: { apikey: pub, Authorization: "Bearer " + pub, "Content-Type": "application/json" }, body: JSON.stringify({ p_key: env.SHASTRA_FEED_KEY }) }); data = await r.json(); } catch (e) { data = null; }
  if (!r || !r.ok || !data || data.ok === false || !Array.isArray(data.holidays)) {
    const prev = await getSetting(env, "holidays", null);
    const why = (data && (data.error || data.message)) || (r && r.ok && data ? "the answer has no list of holidays" : r ? "HTTP " + r.status : "no answer");
    await setSetting(env, "holidays", { ...(prev || {}), ok: false, tried_at: Date.now(), error: str(why, 200) });
    return null;
  }
  const rows = data.holidays.filter((x) => x && /^\d{4}-\d{2}-\d{2}/.test(String(x.date || ""))).map((x) => ({ date: String(x.date).slice(0, 10), name: str(x.name || "", 80) }));
  await setSetting(env, "holidays", { ok: true, at: Date.now(), rows });
  await loadHolidays(env, true);
  return rows;
}
/* Each client's people from WFM: the projects matched to it (its roster project names), added up. */
async function clientWfm(env, clientIds) {
  const w = await getSetting(env, "wfm_projects", null), out = new Map();
  if (!w || !Array.isArray(w.rows) || !w.rows.length) return out;
  // "P1" and "p1" are the same project: their numbers add up rather than the last one quietly winning
  const byKey = new Map();
  const nOf = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  for (const x0 of w.rows) { if (!x0 || !x0.name) continue;
    const x = { ...x0, billable: nOf(x0.billable) }; for (const f of ["assigned_fte", "agents", "training", "team_fte", "people"]) x[f] = nOf(x0[f]) || 0;
    const k = projKey(x.name), y = byKey.get(k); if (!y) { byKey.set(k, x); continue; }
    for (const f of ["assigned_fte", "agents", "training", "team_fte", "people"]) y[f] += x[f];
    if (x.billable != null) y.billable = (y.billable || 0) + x.billable; }
  // a project matched to more than one active client is shared out evenly between them, so it is not counted twice
  const users = new Map();
  for (const c of await all(env, "SELECT id, roster_names_json FROM clients WHERE active = 1")) for (const k of new Set(jsonList(c.roster_names_json).map(projKey))) users.set(k, (users.get(k) || 0) + 1);
  for (const id of clientIds) {
    const c = await one(env, "SELECT roster_names_json FROM clients WHERE id = ?", id);
    const keys = [...new Set(jsonList(c && c.roster_names_json).map(projKey))].filter((k) => byKey.has(k));
    if (!keys.length) continue;
    const ps = keys.map((k) => ({ x: byKey.get(k), share: 1 / Math.max(1, users.get(k) || 1) }));
    const sum = (f) => Math.round(ps.reduce((t, { x, share }) => t + (x[f] || 0) * share, 0) * 100) / 100;
    const bills = ps.filter(({ x }) => x.billable != null);
    out.set(id, { projects: ps.map(({ x }) => x.name), billable: bills.length ? Math.round(bills.reduce((t, { x, share }) => t + x.billable * share, 0) * 100) / 100 : null, assigned_fte: sum("assigned_fte"), agents: sum("agents"), training: sum("training"),
      team_fte: sum("team_fte"), people: sum("people"), at: w.at, today: w.today,
      shared: ps.filter(({ share }) => share < 1).map(({ x, share }) => ({ name: x.name, clients: Math.round(1 / share) })) });
  }
  return out;
}
const fteTxt = (v) => (v == null ? "–" : String(Math.round(v * 10) / 10));
/* A client's escalations received in a period, for the SLA (threshold 0). */
async function escSummary(env, clientId, from, to, now = Date.now()) {
  // External (the client's own escalations: its SLA KPI, target 0) and Internal, counted side by side
  const every = await all(env, "SELECT * FROM escalations WHERE client_id = ? AND day >= ? AND day <= ? ORDER BY day DESC, sr DESC", clientId, from, to);
  const part = (xs) => {
    const open = xs.filter((e) => e.status !== "resolved"), closed = xs.filter((e) => e.status === "resolved" && e.resolved_at);
    const by = new Map(); xs.forEach((e) => by.set(e.dept, (by.get(e.dept) || 0) + 1));
    return { n: xs.length, open: open.length, over24: open.filter((e) => escPast(e.created_at, now)).length, over24_reason: open.filter((e) => escPast(e.created_at, now) && e.delay_reason).length,
      errors: xs.filter((e) => e.is_error === "Y").length, avg_hours: closed.length ? Math.round(closed.reduce((t, e) => t + escHours(e), 0) / closed.length) : null,
      by_dept: [...by.entries()].map(([dept, n]) => ({ dept, n })) };
  };
  const ext = part(every.filter((e) => escKind(e) === "external")), int = part(every.filter((e) => escKind(e) === "internal")), both = part(every);
  return { from, to, target: ESC_SLA_TARGET, ...ext, met: ext.n <= ESC_SLA_TARGET, internal: int.n, int, all: both,
    rows: every.slice(0, 20).map((e) => ({ id: e.id, sr: e.sr, kind: escKind(e), dept: e.dept, day: e.day, description: e.description, is_error: e.is_error, error_by_name: e.is_error === "Y" ? e.error_by_name || "" : "",
      error_dow: e.is_error === "Y" ? e.error_dow || "" : "", owner_name: e.owner_name, status: e.status, close_on: e.close_on, open_hours: e.status !== "resolved" ? Math.floor(workingHoursBetween(e.created_at, now)) : null,
      past24: e.status !== "resolved" && escPast(e.created_at, now), delay_reason: e.delay_reason, expected_on: e.expected_on })) };
}
/* Fire-and-forget after a save: find the workbook (location first, then client) and append the entry. */
async function syncEntryToWorkbook(env, claimId, by, extra) {
  const c = await one(env, `SELECT c.*, cl.name AS client_name, cl.workbook_link AS client_link, l.name AS location_name, l.workbook_link AS location_link
      FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE c.id = ?`, claimId);
  if (!c) return;
  // The Team Lead column: the person the biller reports to, when the session did not carry the name.
  if (by && by.reports_to && !by.reports_to_name) { const r = await one(env, "SELECT name FROM users WHERE id = ?", by.reports_to); if (r) by = { ...by, reports_to_name: r.name }; }
  const row = productionRow(c, by, extra);
  // Every entry goes to this month's file in the client's own Production folder (Brahmastra Clients / <Client> / Production).
  if (String(env.REPORTS_AUTO || "on").toLowerCase() === "off") return;
  try {
    const tok = await graphAppToken(env);
    const loc = await clientProductionFile(env, tok, c.client_id, (extra && extra.ended_at) || Date.now());
    await appendRowTo(tok, loc, row);
    await recordWorkbookStatus(env, c.client_id, { ok: true, auto: true, at: Date.now(), file: loc.path, claim_no: c.claim_no });
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await recordWorkbookStatus(env, c.client_id, { ok: false, auto: true, at: Date.now(), error: msg, claim_no: c.claim_no });
    try { await folderTrouble(env, c.client_id, msg); } catch (x) {}
  }
}
const otpCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };
const otpHash = (env, email, code) => sha256Hex(`otp:${email}:${code}:${env.PEPPER || DEFAULT_PEPPER}`);
/* Anyone can ask for a code in someone's name without signing in (Access Admin, Sign in with a code), so asking must never take a
   code away from the person or lock them out: a new code does not cancel the ones still valid (checkOtp takes any of them, once),
   and the hourly limit below still lets a code out when none is valid any more. */
async function issueOtp(env, email, purpose, data, { byTeamLead = false } = {}) {
  const now = Date.now();
  const recent = await one(env, "SELECT COUNT(*) AS n, MAX(created_at) AS last, COALESCE(SUM(tries), 0) AS tries, COALESCE(SUM(CASE WHEN consumed = 0 AND expires_at >= ? THEN 1 ELSE 0 END), 0) AS live FROM otps WHERE email = ? AND created_at > ?", now, email, now - 3600000);
  // The 45-second pause protects the mailbox; a team lead reading the code off the screen does not need it.
  if (!byTeamLead && recent && recent.last && now - recent.last < 45000) throw new ApiError(429, "A code was sent less than a minute ago. Check your inbox (and spam), then try again.");
  // At most 10 an hour. After that a new one goes out only when none is still valid and nobody typed a wrong code in the hour: the
  // person always has a code that works or can get one, and the number of guesses an hour stays what it was.
  if (recent && recent.n >= 10) {
    if (recent.live > 0) throw new ApiError(429, "A code sent to this email in the last few minutes still works. Use the newest one (check spam too).");
    if (recent.tries > 0) throw new ApiError(429, "Too many codes requested for this email in the last hour. Try again later.");
  }
  const code = otpCode();
  await env.DB.batch([
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
  // Every code still valid for this email works (a new request does not cancel the one already in the mailbox).
  const live = await all(env, "SELECT * FROM otps WHERE email = ? AND consumed = 0 AND expires_at >= ? ORDER BY created_at DESC LIMIT 20", email, now);
  if (!live.length) throw new ApiError(401, "That code has expired or was never sent. Request a new one.");
  const hash = await otpHash(env, email, String(code || "").replace(/\s/g, ""));
  const row = live.find((r) => sameHash(hash, r.code_hash));
  if (!row) {
    // a wrong code counts against every code still valid, so more codes never mean more guesses; each is dead after 5
    await run(env, "UPDATE otps SET tries = tries + 1, consumed = CASE WHEN tries + 1 >= ? THEN 1 ELSE consumed END WHERE email = ? AND consumed = 0 AND expires_at >= ?", OTP_MAX_TRIES, email, now);
    throw new ApiError(401, live.every((r) => r.tries + 1 >= OTP_MAX_TRIES) ? "Too many wrong codes. Request a new one." : "That code doesn't match. Check the latest email and try again.");
  }
  // one sign-in uses up every code still valid for this email
  await run(env, "UPDATE otps SET consumed = 1 WHERE email = ? AND consumed = 0", email);
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

/* ---- Drishti session tokens: the same format and signature as makeToken() in Drishti's Code.gs ----
   base64url(id|role|expiry) + "." + base64url(HMAC-SHA256(payload, TOKEN_SECRET)), padding kept, valid 12 hours. */
const DRISHTI_API_DEFAULT = "https://script.google.com/macros/s/AKfycbyS6jIwVM0gIhMHS9woiCdDqBQUQWsujZaM2X1h9d1KZIvfMwIwBqhXMNhJEpvhMAgu/exec";
const b64webSafe = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_"); };
async function drishtiToken(env, id, role) {
  const payload = id + "|" + role + "|" + (Date.now() + 12 * 3600000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.DRISHTI_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return b64webSafe(new TextEncoder().encode(payload)) + "." + b64webSafe(sig);
}

/* ---- Drishti's SLA scorecard, read by Brahmastra (nothing in Drishti changes) ----
   DR_DEF is Drishti's own scopes, KPIs, thresholds, formula text and formula book, copied as data. The scoring below is
   Drishti's clientScorecard, line for line: a KPI is green, amber or red by its rule (a client's own overrides apply),
   an SLA line by achieved ÷ received (90% green, 70% amber), the score is the green share of everything scored, and
   the band is 90 green, 80 amber. Drishti's Apps Script answers "overview" as Drishti's Admin (DRISHTI_TOKEN_SECRET);
   the answer is kept ten minutes. Brahmastra's clients match Drishti's by name. */
const DR_DEF = {"scopes":[{"key":"ar","name":"Account Receivable","short":"AR","kind":"kpi","group":"kpi","hasAging":true,"sla":["Production SLA"],"criteria":[{"key":"arAging","name":"AR Aging","type":"pct","fmt":null,"std":"Less than 15% older than 90 days","formula":"Balance in >90-day buckets ÷ Total AR balance × 100","rule":{"dir":"lower","good":0.15,"fair":0.15,"fmt":"percent"},"inputs":[]},{"key":"collectionRate","name":"Collection Rate","type":"calc","fmt":"percent","std":"Net collection rate · payments ÷ (charges − contractual adjustments)","formula":"Payments ÷ (Charges − Contractual Adjustments) × 100","rule":{"dir":"higher","good":0.85,"fair":0.7,"fmt":"percent"},"inputs":["Payments received","Charges (billed)","Contractual adjustments"]},{"key":"denialRate","name":"Denial Rate","type":"calc","fmt":"percent","std":"<5% excellent · 5–10% good · >10% red","formula":"Denial count ÷ Posted claim count × 100","rule":{"dir":"lower","good":0.1,"fair":0.1,"best":0.05,"fmt":"percent"},"inputs":["Denied (count)","Posted claims (count)"]},{"key":"daysInAR","name":"Days in AR","type":"calc","fmt":"days","std":"≤30 best practice · 31–40 acceptable · >40 issue","formula":"Total AR ÷ (Total payments ÷ days in the period)","rule":{"dir":"lower","good":30,"fair":40,"fmt":"days"},"inputs":["Total AR inventory ($)","Avg daily payment ($)"]},{"key":"appeal","name":"Appeal %","type":"pct","fmt":null,"std":"<5% green · 5–10% amber · >10% red","formula":"Appeals filed ÷ Denials received × 100","rule":{"dir":"lower","good":0.05,"fair":0.1,"fmt":"percent"},"inputs":[]},{"key":"quality","name":"Quality","type":"pct","fmt":null,"std":"≥98% green · 95–<98% amber · <95% red","formula":"Average of Final Audit Score % (audit report)","rule":{"dir":"higher","good":0.98,"fair":0.95,"fmt":"percent"},"inputs":[]},{"key":"escalations","name":"Escalations","type":"count","fmt":null,"std":"0 green · 1+ red","formula":"Count of escalations (SR no. in tracker)","rule":{"dir":"lower","good":0,"fair":0,"fmt":"count"},"inputs":[]}]},{"key":"submission","name":"Submission","short":"Submission","kind":"kpi","group":"kpi","hasAging":false,"sla":["Claim Submission","Claim Rejection"],"criteria":[{"key":"cleanClaim","name":"Clean Claim","type":"pct","fmt":null,"std":"90%","formula":"","rule":{"dir":"higher","good":0.9,"fair":0.8,"fmt":"percent"},"inputs":[]},{"key":"submissionTAT","name":"Submission TAT","type":"status","fmt":null,"std":"24hr","formula":"","rule":null,"inputs":[]},{"key":"inflowVsSubmitted","name":"Inflow vs Submitted","type":"pct","fmt":null,"std":"100%","formula":"","rule":{"dir":"higher","good":1,"fair":0.95,"fmt":"percent"},"inputs":[]},{"key":"rejectionRate","name":"Rejection Rate","type":"pct","fmt":null,"std":"5%","formula":"","rule":{"dir":"lower","good":0.05,"fair":0.1,"fmt":"percent"},"inputs":[]},{"key":"resubmission","name":"Resubmission","type":"pct","fmt":null,"std":"100%","formula":"","rule":{"dir":"higher","good":1,"fair":0.9,"fmt":"percent"},"inputs":[]},{"key":"quality","name":"Quality","type":"pct","fmt":null,"std":"99%","formula":"","rule":{"dir":"higher","good":0.99,"fair":0.95,"fmt":"percent"},"inputs":[]},{"key":"escalations","name":"Escalations","type":"count","fmt":null,"std":"0","formula":"","rule":{"dir":"lower","good":0,"fair":0,"fmt":"count"},"inputs":[]}]},{"key":"ev","name":"Benefit Verification","short":"EV","kind":"kpi","group":"kpi","hasAging":false,"sla":["Benefits Verification"],"criteria":[{"key":"completionRate","name":"Verification Completion %","type":"pct","fmt":null,"std":"Completed ÷ Total","formula":"Completed verifications ÷ Total verifications × 100","rule":{"dir":"higher","good":0.95,"fair":0.9,"fmt":"percent"},"inputs":[]},{"key":"newPatientsTAT","name":"New Patients TAT","type":"status","fmt":null,"std":"Same Day","formula":"","rule":null,"inputs":[]},{"key":"urgentRequestTAT","name":"Urgent Request TAT","type":"status","fmt":null,"std":"3hr","formula":"","rule":null,"inputs":[]},{"key":"tat","name":"TAT","type":"status","fmt":null,"std":"48–72hr","formula":"","rule":null,"inputs":[]},{"key":"urgentVsRegular","name":"Urgent vs Regular verification","type":"text","fmt":null,"std":"count split","formula":"Urgent count vs Regular count (from EV file)","rule":null,"inputs":[]},{"key":"quality","name":"Quality","type":"pct","fmt":null,"std":"99%","formula":"","rule":{"dir":"higher","good":0.99,"fair":0.95,"fmt":"percent"},"inputs":[]},{"key":"escalations","name":"Escalations","type":"count","fmt":null,"std":"0","formula":"","rule":{"dir":"lower","good":0,"fair":0,"fmt":"count"},"inputs":[]}]},{"key":"pp","name":"Payment Posting","short":"Payment Posting","kind":"kpi","group":"kpi","hasAging":false,"sla":["Payment Posting"],"criteria":[{"key":"ppTAT","name":"Payment Posting TAT","type":"status","fmt":null,"std":"24hr","formula":"","rule":null,"inputs":[]},{"key":"paymentCycle","name":"Payment Cycle","type":"calc","fmt":"days","std":"≤30 good · 31–45 acceptable · >45 flag","formula":"Avg (Paid date − Submission date) in days","rule":{"dir":"lower","good":30,"fair":45,"fmt":"days"},"inputs":[]},{"key":"underpaymentRate","name":"Underpayment Rate","type":"pct","fmt":null,"std":"<5% good, else review","formula":"Total (Allowed − Paid, where Paid<Allowed) ÷ Total Allowed × 100","rule":{"dir":"lower","good":0.05,"fair":0.05,"fmt":"percent"},"inputs":[]},{"key":"varianceRate","name":"Variance Rate","type":"pct","fmt":null,"std":"≤2% good, 2 to 5% watch, over 5% flag","formula":"Discrepancy amount (from discrepancy file) ÷ total received for posting × 100","rule":{"dir":"lower","good":0.02,"fair":0.05,"fmt":"percent"},"inputs":[]},{"key":"paymentAdjustmentRate","name":"Payment Adjustment Rate","type":"pct","fmt":null,"std":"≤5% good, 5 to 10% watch, over 10% flag","formula":"Write-off excluding CO45 ÷ gross charges billed × 100","rule":{"dir":"lower","good":0.05,"fair":0.1,"fmt":"percent"},"inputs":[]},{"key":"quality","name":"Quality","type":"pct","fmt":null,"std":"99%","formula":"","rule":{"dir":"higher","good":0.99,"fair":0.95,"fmt":"percent"},"inputs":[]},{"key":"topPayer","name":"Top Payer (include %)","type":"text","fmt":null,"std":"","formula":"","rule":null,"inputs":[]},{"key":"billedVsAllowed","name":"Billed vs Allowed","type":"text","fmt":null,"std":"","formula":"","rule":null,"inputs":[]},{"key":"websiteTrack","name":"Website Tracker maintained","type":"yesno","fmt":null,"std":"Yes / No, set by supervisor","formula":"","rule":null,"inputs":[]},{"key":"recoupmentRate","name":"Recoupment Rate","type":"pct","fmt":null,"std":"<5% good, else review","formula":"Amount recouped ÷ total payment received × 100","rule":{"dir":"lower","good":0.05,"fair":0.05,"fmt":"percent"},"inputs":[]},{"key":"patientVsInsurance","name":"Patient vs Insurance Collection","type":"text","fmt":null,"std":"ratio, patient ÷ insurance","formula":"Patient collection ÷ Insurance collection","rule":null,"inputs":[]},{"key":"escalations","name":"Escalations","type":"count","fmt":null,"std":"0","formula":"","rule":{"dir":"lower","good":0,"fair":0,"fmt":"count"},"inputs":[]}]},{"key":"cred","name":"Credentialing","short":"Credentialing","kind":"tasks","group":"sla","hasAging":false,"sla":[],"criteria":[]},{"key":"pcc","name":"PCC","short":"PCC","kind":"tasks","group":"sla","hasAging":false,"sla":[],"criteria":[{"key":"inflowVsPicked","name":"Production Inflow vs Picked-up Calls","type":"pct","fmt":null,"std":"≥90% green, 80 to 89% amber, under 80% red","formula":"Picked-up calls ÷ inflow calls × 100","rule":{"dir":"higher","good":0.9,"fair":0.8,"fmt":"percent"},"inputs":[]},{"key":"missedCalls","name":"Missed Calls","type":"count","fmt":null,"std":"count","formula":"","rule":null,"inputs":[]},{"key":"callbacksMade","name":"Callbacks Made on Missed Calls","type":"count","fmt":null,"std":"count","formula":"","rule":null,"inputs":[]},{"key":"callbackRate","name":"Callback Rate","type":"pct","fmt":null,"std":"≥90% green, 80 to 89% amber, under 80% red","formula":"Callbacks made ÷ missed calls × 100","rule":{"dir":"higher","good":0.9,"fair":0.8,"fmt":"percent"},"inputs":[]},{"key":"callsDropped","name":"Calls Dropped (in queue or other)","type":"count","fmt":null,"std":"count","formula":"","rule":null,"inputs":[]},{"key":"dropRate","name":"Call Drop Rate","type":"pct","fmt":null,"std":"lower is better, ≤5% green, 5 to 10% amber, over 10% red","formula":"Calls dropped ÷ total inflow calls × 100","rule":{"dir":"lower","good":0.05,"fair":0.1,"fmt":"percent"},"inputs":[]},{"key":"avgHoldTime","name":"Average Hold Time","type":"text","fmt":null,"std":"time","formula":"","rule":null,"inputs":[]},{"key":"avgHandlingTime","name":"Average Call Handling Time","type":"text","fmt":null,"std":"time","formula":"","rule":null,"inputs":[]},{"key":"avgSpeedAnswer","name":"Average Speed of Answer","type":"text","fmt":null,"std":"time","formula":"","rule":null,"inputs":[]},{"key":"perPersonTarget","name":"Per Person Target vs Actual Calls","type":"text","fmt":null,"std":"user-wise","formula":"","rule":null,"inputs":[]},{"key":"outboundTargetVsActual","name":"Outbound Target vs Actual Calls","type":"pct","fmt":null,"std":"≥90% green, 80 to 89% amber, under 80% red","formula":"Actual outbound ÷ outbound target × 100","rule":{"dir":"higher","good":0.9,"fair":0.8,"fmt":"percent"},"inputs":[]},{"key":"correspondence","name":"Correspondence Received vs Sent","type":"pct","fmt":null,"std":"≥90% green, 80 to 89% amber, under 80% red","formula":"Sent ÷ received × 100","rule":{"dir":"higher","good":0.9,"fair":0.8,"fmt":"percent"},"inputs":[]},{"key":"faxEmail","name":"Fax / Email Received vs Completed","type":"pct","fmt":null,"std":"≥90% green, 80 to 89% amber, under 80% red","formula":"Completed ÷ received × 100","rule":{"dir":"higher","good":0.9,"fair":0.8,"fmt":"percent"},"inputs":[]}]}],"book":{"ar.arAging":{"from":"AR Inventory report"},"ar.collectionRate":{"from":"Payment Posting report"},"ar.denialRate":{"from":"Denial report and Payment Posting report"},"ar.daysInAR":{"from":"AR Inventory report, Payment Posting report and the days in the selected duration","page":"Total AR ÷ (Total payments ÷ days in the period)"},"ar.appeal":{"from":"AR Inventory report (comment or status column) and Denial report"},"ar.quality":{"from":"AR Audit report"},"ar.escalations":{"from":"Escalation Tracker"},"submission.cleanClaim":{"from":"Claim Submission, Claim Rejection and Denial reports","f":"(Submitted − Rejected − Denied) ÷ Submitted × 100"},"submission.submissionTAT":{"from":"Typed in by the supervisor","manual":true,"f":"Marked Met or Not met against the standard"},"submission.inflowVsSubmitted":{"from":"Claim Submission and Submission Inflow reports","f":"Submitted claims ÷ Inflow claims × 100"},"submission.rejectionRate":{"from":"Claim Rejection and Claim Submission reports","f":"Rejected claims ÷ Submitted claims × 100"},"submission.resubmission":{"from":"Typed in by the supervisor","manual":true,"f":"Denied claims resubmitted ÷ Denied claims × 100"},"submission.quality":{"from":"Submission Audit report","f":"Average of Final Audit Score % (audit report)"},"submission.escalations":{"from":"Escalation Tracker, Submission rows","f":"Count of escalations for this department"},"ev.completionRate":{"from":"EV / Benefit Verification report"},"ev.newPatientsTAT":{"from":"Typed in by the supervisor","manual":true,"f":"Marked Met or Not met against the standard"},"ev.urgentRequestTAT":{"from":"Typed in by the supervisor","manual":true,"f":"Marked Met or Not met against the standard"},"ev.tat":{"from":"Typed in by the supervisor","manual":true,"f":"Marked Met or Not met against the standard"},"ev.urgentVsRegular":{"from":"EV / Benefit Verification report"},"ev.quality":{"from":"Typed in by the supervisor","manual":true},"ev.escalations":{"from":"Escalation Tracker, Benefit Verification rows","f":"Count of escalations for this department"},"pp.ppTAT":{"from":"Typed in by the supervisor","manual":true,"f":"Marked Met or Not met against the standard"},"pp.paymentCycle":{"from":"Submission file and Paid-claims file, matched claim by claim"},"pp.underpaymentRate":{"from":"Patient-wise Ledger"},"pp.varianceRate":{"from":"Variance / Discrepancy file and Amount Received for Posting file"},"pp.paymentAdjustmentRate":{"from":"Non-Contractual Adjustment file and Payment Posting report"},"pp.quality":{"from":"Payment Posting Audit report","f":"Average of Final Audit Score % (audit report)"},"pp.topPayer":{"from":"Typed in by the supervisor","manual":true},"pp.billedVsAllowed":{"from":"Typed in by the supervisor","manual":true},"pp.websiteTrack":{"from":"Typed in by the supervisor","manual":true,"f":"Yes or No"},"pp.recoupmentRate":{"from":"Recoupment file and Payment Posting report"},"pp.patientVsInsurance":{"from":"Payment Posting report (payer type column)"},"pp.escalations":{"from":"Escalation Tracker, Payment Posting rows","f":"Count of escalations for this department"},"pcc.inflowVsPicked":{"from":"Call Log"},"pcc.missedCalls":{"from":"Call Log","f":"Count of missed calls"},"pcc.callbacksMade":{"from":"Callbacks on Missed Calls file","f":"Count of completed callbacks"},"pcc.callbackRate":{"from":"Callbacks on Missed Calls file and Call Log"},"pcc.callsDropped":{"from":"Call Log","f":"Count of dropped calls"},"pcc.dropRate":{"from":"Call Log"},"pcc.avgHoldTime":{"from":"Typed in by the supervisor","manual":true},"pcc.avgHandlingTime":{"from":"Typed in by the supervisor","manual":true},"pcc.avgSpeedAnswer":{"from":"Typed in by the supervisor","manual":true},"pcc.perPersonTarget":{"from":"Typed in by the supervisor","manual":true},"pcc.outboundTargetVsActual":{"from":"Typed in by the supervisor","manual":true},"pcc.correspondence":{"from":"Correspondence file"},"pcc.faxEmail":{"from":"Fax / Email file"}}};
const DR_BY = Object.fromEntries(DR_DEF.scopes.map((x) => [x.key, x]));
const DR_FRESH_MS = 10 * 60000, DR_TYPED = "Typed in by the supervisor";
const drNum = (v) => { if (v === "" || v == null) return null; const t = String(v).replace(/[$,%\s]/g, ""); if (t === "") return null; const x = Number(t); return isNaN(x) ? null : x; };
const drIsNum = (v) => typeof v === "number" && !isNaN(v);
/* A KPI cell with nothing in it (null, "", NaN) is "not scored yet", like a missing one. */
const drHasVal = (crit, cell) => !!cell && !(cell.value == null || cell.value === "" || (typeof cell.value === "number" && isNaN(cell.value)));
/* A number Drishti sent as text ("0.10", "91%", "$1,200") is read as the number, so it is scored like any other; "91%" on a
   percent KPI is 0.91. Text that is not a number stays as typed (and is not scored). */
/* A Quality score is always a percent: 18 (a number, or the text "18") is 18%, not 1800%. 0.95 and "95%" are 95% as before.
   Other KPIs keep Drishti's reading (1.05 can be 105% production; 1.5 can be a 1.5% denial rate). */
const drQualityPct = (crit) => !!crit && crit.key === "quality" && drFmt(crit) === "percent";
const drCell = (crit, cell) => {
  if (!cell || ["status", "yesno", "text"].includes(crit.type)) return cell;
  if (typeof cell.value === "number") return drQualityPct(crit) && cell.value > 1 ? { ...cell, value: cell.value / 100 } : cell;
  if (typeof cell.value !== "string") return cell;
  const x = drNum(cell.value); if (x == null) return cell;
  const pctSign = /%\s*$/.test(cell.value) && drFmt(crit) === "percent";
  return { ...cell, value: pctSign || (drQualityPct(crit) && x > 1) ? x / 100 : x };
};
const drBand = (pct) => (pct == null ? null : pct >= 90 ? "ok" : pct >= 80 ? "warn" : "miss");
const drFmt = (crit) => crit.fmt || (crit.rule && crit.rule.fmt) || (crit.type === "count" ? "count" : "percent");
const drFmtVal = (v, fmt) => {
  if (!drIsNum(v)) return v == null || v === "" ? "" : String(v);
  if (fmt === "percent") { const p = Math.round(v * 1000) / 10; return (Number.isInteger(p) ? String(p) : p.toFixed(1)) + "%"; }
  if (fmt === "days") { const x = Math.round(v); return x + (x === 1 ? " day" : " days"); }
  if (fmt === "count") return Math.round(v).toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
function drStatusFor(actual, rule) {
  if (!drIsNum(actual) || !rule) return "info";
  if (rule.dir === "higher") { if (rule.best != null && actual >= rule.best) return "great"; return actual >= rule.good ? "ok" : actual >= rule.fair ? "warn" : "miss"; }
  if (rule.dir === "lower") { if (rule.best != null && actual <= rule.best) return "great"; return actual <= rule.good ? "ok" : actual <= rule.fair ? "warn" : "miss"; }
  if (rule.dir === "range") { if (actual >= rule.min && actual <= rule.max) return "ok"; const t = ((rule.max - rule.min) || 1) * 0.5; return (actual >= rule.min - t && actual <= rule.max + t) ? "warn" : "miss"; }
  return "info";
}
function drCritStatus(crit, cell, rule) {
  if (!cell) return "info";
  const word = String(cell.value == null ? "" : cell.value).trim().toLowerCase().replace(/\s+/g, " ");   // "Not met", "Not  Met", "met", "yes" alike
  if (crit.type === "status") return word === "met" ? "ok" : word === "not met" ? "miss" : "info";
  if (crit.type === "yesno") return word === "yes" ? "ok" : word === "no" ? "miss" : "info";
  if (crit.type === "text") return "info";
  return drStatusFor(cell.value, rule);
}
const drRule = (client, scopeKey, crit) => ({ ...(crit.rule || { dir: "info", fmt: "percent" }), ...(((client && client.rules) || {})[scopeKey + "." + crit.key] || {}) });
const drTarget = (crit, rule) => crit.type === "status" ? "Met" : crit.type === "yesno" ? "Yes" : crit.type === "text" ? "" : !rule ? ""
  : rule.dir === "higher" ? "≥ " + drFmtVal(rule.good, rule.fmt) : rule.dir === "lower" ? "≤ " + drFmtVal(rule.good, rule.fmt) : rule.dir === "range" ? drFmtVal(rule.min, rule.fmt) + " to " + drFmtVal(rule.max, rule.fmt) : "";
const drDisplay = (crit, cell) => !cell ? "" : ["status", "yesno", "text"].includes(crit.type) ? String(cell.value || "") : drFmtVal(cell.value, drFmt(crit));
const drFormula = (sc, crit) => { const b = DR_DEF.book[sc.key + "." + crit.key] || {}; return b.f || crit.formula || (crit.type === "status" ? "Marked Met or Not met against the standard" : crit.type === "yesno" ? "Yes or No" : crit.type === "text" ? "As typed" : ""); };
const drSource = (sc, crit, cell) => { const b = DR_DEF.book[sc.key + "." + crit.key] || {}; return cell && cell.method === "manual" && !b.manual ? DR_TYPED + " (in place of the file)" : (b.from || DR_TYPED); };
/* Drishti's clientScorecard: one period of one client (prev: the period before, for the change) */
function drScore(client, period, prev) {
  const active = ((client && client.scopes) || []).map((k) => DR_BY[k]).filter(Boolean);
  const items = [], scopes = [], kpi = { ok: 0, warn: 0, miss: 0 }, sla = { ok: 0, warn: 0, miss: 0 };
  const px = (period && period.scopes) || {};
  const task = (sc, row, into, s) => {
    const rec = drNum(row.received), ach = drNum(row.achieved); if (!(drIsNum(rec) && rec > 0 && drIsNum(ach))) return;
    const pc = ach / rec, st = pc >= 0.9 ? "ok" : pc >= 0.7 ? "warn" : "miss";
    sla[st]++; into[st]++; if (s) s[st]++;
    const it = { scope: sc.short, scope_key: sc.key, key: "task:" + row.name, name: row.name, kind: "SLA", value: Math.round(pc * 1000) / 1000, shown: Math.round(pc * 100) + "%", target: "≥ 90%", status: st, great: pc >= 0.98,
      reason: row.comment || "", source: "Typed · received " + rec.toLocaleString() + ", achieved " + ach.toLocaleString() + (row.target ? ", target " + row.target : ""), formula: "Achieved ÷ Received × 100", std: "90% and above green · 70 to 89% amber · under 70% red" };
    items.push(it); if (s) s.items.push(it); return it;
  };
  for (const sc of active) {
    const s = { key: sc.key, name: sc.name, short: sc.short, ok: 0, warn: 0, miss: 0, items: [] }, sS = { ok: 0, warn: 0, miss: 0 };
    for (const crit of sc.criteria || []) {
      const cell0 = px[sc.key] && px[sc.key].crit && px[sc.key].crit[crit.key]; if (!drHasVal(crit, cell0)) continue;
      const cell = drCell(crit, cell0);
      const rule = drRule(client, sc.key, crit), st0 = drCritStatus(crit, cell, rule), st = st0 === "great" ? "ok" : st0;
      const it = { scope: sc.short, scope_key: sc.key, key: crit.key, name: crit.name, kind: "KPI", value: cell.value, shown: drDisplay(crit, cell), target: drTarget(crit, rule), status: st, great: st0 === "great",
        rule: rule && ["higher", "lower", "range"].includes(rule.dir) ? { dir: rule.dir, good: rule.good, fair: rule.fair, min: rule.min, max: rule.max, fmt: rule.fmt || drFmt(crit) } : null, type: crit.type,
        reason: String(cell.reason || "").slice(0, 300), source: drSource(sc, crit, cell), formula: drFormula(sc, crit), std: crit.std || "" };
      items.push(it); s.items.push(it);
      if (st === "ok" || st === "warn" || st === "miss") { s[st]++; kpi[st]++; }
    }
    if (sc.kind === "tasks") for (const row of (px[sc.key] && px[sc.key].tasks) || []) task(sc, row, sS, s);
    // what this scope could score but has nothing for yet, and the report that would fill it
    s.missing = (sc.criteria || []).filter((crit) => crit.type !== "text" && !drHasVal(crit, px[sc.key] && px[sc.key].crit && px[sc.key].crit[crit.key]))
      .map((crit) => { const b = DR_DEF.book[sc.key + "." + crit.key] || {}; return { key: crit.key, name: crit.name, from: b.from || DR_TYPED, typed: !!b.manual }; });
    s.scored = s.ok + s.warn + s.miss; s.pct = s.scored ? Math.round(s.ok / s.scored * 100) : null; s.band = drBand(s.pct);
    scopes.push(s);
  }
  const merged = { key: "sla", name: "SLA tasks", short: "SLA", ok: 0, warn: 0, miss: 0, items: [] }, mS = { ok: 0, warn: 0, miss: 0 };
  for (const row of (px.sla && px.sla.tasks) || []) task({ key: "sla", short: "SLA" }, row, mS, merged);
  merged.scored = merged.ok + merged.warn + merged.miss; if (merged.scored) { merged.pct = Math.round(merged.ok / merged.scored * 100); merged.band = drBand(merged.pct); scopes.push(merged); }
  const c = { ok: kpi.ok + sla.ok, warn: kpi.warn + sla.warn, miss: kpi.miss + sla.miss }, scored = c.ok + c.warn + c.miss;
  const pct = scored ? Math.round(c.ok / scored * 100) : null;
  const kS = kpi.ok + kpi.warn + kpi.miss, sS2 = sla.ok + sla.warn + sla.miss;
  const rank = { miss: 0, warn: 1, ok: 2, info: 3 };
  const drags = items.filter((x) => x.status === "warn" || x.status === "miss").sort((a, b) => rank[a.status] - rank[b.status]);
  const strengths = items.filter((x) => x.status === "ok").sort((a, b) => (b.great ? 1 : 0) - (a.great ? 1 : 0));
  let delta = null; if (prev) { const pv = drScore(client, prev, null).pct; if (pct != null && pv != null) delta = pct - pv; }
  return { pct, band: drBand(pct), scored, counts: c, kpi_pct: kS ? Math.round(kpi.ok / kS * 100) : null, sla_pct: sS2 ? Math.round(sla.ok / sS2 * 100) : null, scopes, items, drags, strengths, delta };
}
const drKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/* The one rule both the Portfolio and the scorecard use to find a Brahmastra client in Drishti: by name, ignoring case, spaces and
   punctuation. When two Drishti clients match, the one spelt exactly the same wins, else the first in Drishti's list, and the
   others are named in ambiguous so the page can say so. */
function drMatch(ov, name) {
  const all2 = ov.clients.filter((c) => drKey(c.name) === drKey(name)); if (!all2.length) return { d: null, ambiguous: [] };
  const exact = all2.filter((c) => String(c.name).trim().toLowerCase() === String(name || "").trim().toLowerCase());
  const d = exact.length === 1 ? exact[0] : all2[0];
  return { d, ambiguous: all2.length > 1 ? all2.map((c) => c.name) : [] };
}
const drPeriodSort = (a, b) => String((b.range || {}).to || "").localeCompare(String((a.range || {}).to || "")) || String((b.range || {}).from || "").localeCompare(String((a.range || {}).from || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
const drKind = (p) => p.kind === "month" || p.kind === "week" || p.kind === "day" ? p.kind : "custom";
async function drishtiCall(env, body) {
  const api = env.DRISHTI_API || DRISHTI_API_DEFAULT;
  let r; try { r = await fetchT(api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" }); }
  catch (e) { throw new ApiError(502, "Drishti's server did not answer. Try again in a minute."); }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!j) throw new ApiError(502, "Drishti's server sent an answer Brahmastra could not read.");
  if (!j.ok) throw new ApiError(j.code === "auth" ? 503 : 400, j.code === "auth" ? "Drishti did not accept Brahmastra's sign-in. The DRISHTI_TOKEN_SECRET does not match Drishti's TOKEN_SECRET." : "Drishti: " + (j.error || "it refused."));
  return j;
}
/* every client in Drishti with its periods of the last seven months (the short copies Drishti keeps), ten minutes at a time */
async function drishtiOverview(env) {
  if (!env.DRISHTI_TOKEN_SECRET) return { state: "off", clients: [], at: null, error: "Drishti single sign-in is not switched on (DRISHTI_TOKEN_SECRET)." };
  const now = Date.now();
  let st = (await getSetting(env, "drishti_sync", null)) || {};
  if (!(st.at && now - st.at < DR_FRESH_MS) && !(st.fail_at && now - st.fail_at < DR_FRESH_MS)) {
    try {
      const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - 7); since.setUTCDate(1);
      const j = await drishtiCall(env, { a: "overview", t: await drishtiToken(env, "admin", "admin"), since: since.toISOString().slice(0, 10) });
      const clients = (Array.isArray(j.value) ? j.value : []).filter((c) => c && typeof c === "object" && !c.archived).map((c) => ({ id: c.id, name: String(c.name || ""), owner: c.ownerName || "", scopes: Array.isArray(c.scopes) ? c.scopes : [], rules: c.rules || {},
        periods: (Array.isArray(c.periods) ? c.periods : []).filter((p) => p && typeof p === "object").map((p) => ({ id: p.id, kind: drKind(p), label: p.label || "", range: p.range || {}, numDays: p.numDays || null, createdAt: p.createdAt || "", createdBy: p.createdBy || "", scopes: p.scopes || {},
          reports: Object.entries(p.reports || {}).map(([k, v]) => ({ key: k, file: (v && v.fileName) || "" })) })).sort(drPeriodSort) }));
      st = { at: now, clients };
    } catch (e) { st = { ...st, fail_at: now, error: str((e && e.message) || "Drishti did not answer", 200) }; }
    await setSetting(env, "drishti_sync", st);
  }
  // stale: Drishti has failed since the last good read; the scorecards (monthly) are still shown, from `at`.
  return { state: st.at ? "ok" : "error", stale: !!(st.at && st.fail_at && st.fail_at > st.at), clients: st.clients || [], at: st.at || null, error: st.error || "" };
}
/* Brahmastra's clients matched to Drishti's by name; each with the latest month (or latest) period scored, and the one before */
function drSummary(ov, clients, today) {
  const out = new Map();
  for (const c of clients) {
    const { d, ambiguous } = drMatch(ov, c.name); if (!d) continue;
    const done = d.periods.filter((p) => !p.range.to || p.range.to < today);
    const months = done.filter((p) => p.kind === "month"), list = months.length ? months : done;
    const cur = list[0]; if (!cur) { out.set(c.id, { drishti_id: d.id, owner: d.owner, ambiguous, period: null }); continue; }
    const prev = list.find((p) => p !== cur && p.kind === cur.kind && p.range.to < cur.range.from) || null;
    const sc = drScore(d, cur, prev);
    out.set(c.id, { drishti_id: d.id, owner: d.owner, ambiguous, period: { id: cur.id, kind: cur.kind, label: cur.label, from: cur.range.from, to: cur.range.to }, score: sc.pct, band: sc.band, delta: sc.delta, counts: sc.counts,
      scopes: sc.scopes.map((x) => ({ key: x.key, short: x.short, pct: x.pct, band: x.band })), drags: sc.drags.slice(0, 4).map((x) => ({ name: x.name, scope: x.scope, shown: x.shown, status: x.status })) });
  }
  return out;
}
/* The month-end "SLA scored" step ticks itself from Drishti's month score when nobody has ticked it, and follows Drishti when it
   re-scores the month; a score typed in by a person (auto = 0) is kept. */
async function drTickMonthEnd(env, summaries) {
  const stmts = [], now = Date.now();
  for (const [cid, d] of summaries) {
    if (!d.period || d.period.kind !== "month" || d.score == null) continue;
    const month = String(d.period.from || "").slice(0, 7); if (!/^\d{4}-\d{2}$/.test(month)) continue;
    stmts.push(env.DB.prepare(`INSERT INTO client_monthend (client_id, month, step, done_at, done_by_name, auto, score, note) VALUES (?,?,'sla',?,?,1,?,?) ON CONFLICT (client_id, month, step) DO UPDATE SET score = excluded.score, done_at = excluded.done_at
      WHERE client_monthend.auto = 1 AND (client_monthend.score IS NULL OR client_monthend.score <> excluded.score)`).bind(cid, month, now, "Drishti", d.score, "from Drishti's scorecard"));
  }
  if (stmts.length) await batchAll(env, stmts, 50);
}
/* ---- the SAAG entry and the standard note ----
   A worked claim carries a SAAG selection (Status > Sub-status > Action, with
   the Effective Matrix the workbook maps it to) plus a bucket, and a note in
   the team's fixed format. The note is stored as ONE cell (comment) in that
   format, with the individual fields kept in fields_json for the screens. */
const NOTE_SOURCES = ["Call", "Portal", "IVR", "EOB/ERA", "Email", "Clearinghouse", "Client", "Other"];
const BUCKETS4 = ["Payer", "Client", "Closed", "Purview"];
const CLOSED_EFFECTIVE = /^(processing-closed|payment-cash in bank|ar closed-pending posting|posting closed)$/i;
const EFFECTIVE_DAYS = { "Pending-Collectible Insurance": 30, "Pending-Client Assistance": 14, "Pending-Collectible Patient": 30, "Pending-Purview internal review": 7, "Pending-Submission": 15 };
/* Purview's workflow for the actions that go to a desk. Sending a claim for posting closes it for AR (AR's part is done;
   Posting closes it when the payment is posted, then only QA is left). Sending it for submission does not close it: it is
   pending with Submission, then comes back to AR for its follow-up (15 days or a month), the 48-hour recheck and rejections.
   The page uses the same rule (ROUTED_EFFECTIVE in app.jsx). */
const ROUTED_EFFECTIVE = (action) => /^Need to Post\/Posting Correction$/i.test(action || "") ? "AR Closed-Pending Posting"
  : /^(Need to Resubmit|Need to Submit Paper Claim|Correction, Resubmission & Reprocessing)$/i.test(action || "") ? "Pending-Submission" : "";
const ROUTED_BUCKET = { "AR Closed-Pending Posting": "Closed", "Pending-Submission": "Purview" };
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const mmdd = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : (iso || ""));
const FINDINGS_MAX = 4000;
function cleanNoteFields(f, claim) {
  f = f || {};
  const t = (v, n = 400) => str(v, n).replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
  const pre = Array.isArray(f.precheck) ? f.precheck.map((x) => t(x, 80)).filter(Boolean).slice(0, 12) : [];
  // Never cut the findings silently: too long is an error the biller sees (the page counts the characters too).
  if (String(f.findings == null ? "" : f.findings).replace(/\s+/g, " ").trim().length > FINDINGS_MAX) throw bad(`RCA / findings is too long: keep it to ${FINDINGS_MAX.toLocaleString("en-US")} characters.`);
  return {
    dos: mmdd(isoDate(f.dos) || claim.dos) || t(f.dos, 20), clm: t(f.clm || claim.claim_no, 80), denial: t(f.denial, 200),
    source: NOTE_SOURCES.includes(f.source) ? f.source : t(f.source, 40), ref: t(f.ref, 80),
    precheck: pre, precheck_text: t(f.precheck_text, 300), findings: t(f.findings, 20000),
    tfl: limitDays(f.tfl), afl: limitDays(f.afl), denial_date: isoDate(f.denial_date) || "",
    call_start: hhmm(f.call_start), call_end: hhmm(f.call_end),
  };
}
/* ---- TFL / AFL: the payer's timely filing limit (days from DOS) and appeal filing limit (days from the denial / EOB date).
   Billers enter them in the note; the latest value is kept per client and insurance in payer_limits for inventory analysis. */
const limitDays = (v) => { const m = /^\s*(\d{1,4})\s*(d|days?)?\s*$/i.exec(String(v == null ? "" : v)); const n = m ? Number(m[1]) : 0; return n > 0 && n <= 3650 ? n : null; };
const payerKey = (p) => String(p || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const limitLine = (f) => [f.denial_date ? `DENIAL DATE: ${mmdd(f.denial_date)}` : "", f.tfl ? `TFL: ${f.tfl} days` : "", f.afl ? `AFL: ${f.afl} days` : ""].filter(Boolean);
const denialDateStmt = (env, claimId, f) => (f && f.denial_date ? env.DB.prepare("UPDATE claims SET denial_date = ? WHERE id = ?").bind(f.denial_date, claimId) : null);
/* Which claims each limit matters for: the TFL while the payer has not accepted the claim yet, the AFL once it is denied or underpaid.
   Keep in step with TFL_CLASSES / AFL_CLASSES in index.html. */
const TFL_CLASSES = ["rejected", "awaiting", "secondary", "other", "unknown"], AFL_CLASSES = ["denied", "partial"];
function saveLimitsStmt(env, user, clientId, payer, f, source) {
  const key = payerKey(payer);
  if (!key || !clientId || (!f.tfl && !f.afl)) return null;
  return env.DB.prepare(`INSERT INTO payer_limits (client_id, payer_key, payer, tfl_days, afl_days, source, updated_at, updated_by, updated_by_name) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (client_id, payer_key) DO UPDATE SET tfl_days = COALESCE(excluded.tfl_days, tfl_days), afl_days = COALESCE(excluded.afl_days, afl_days),
      source = excluded.source, updated_at = excluded.updated_at, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name`)
    .bind(clientId, key, String(payer).trim(), f.tfl || null, f.afl || null, source, Date.now(), user.id, user.name);
}
/* Call start / end: the clock times the biller enters for a call (HH:MM, 24-hour). They go to the Production Excel and the dashboard, not the note text. */
const hhmm = (v) => { const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(v || "")); return m && +m[1] < 24 && +m[2] < 60 ? String(+m[1]).padStart(2, "0") + ":" + m[2] : ""; };
// A call that runs past midnight (23:50 to 00:10) wraps; an end more than 12 hours "before" the start is a typo, not a call (null).
const callMinutes = (a, b) => { if (!a || !b) return null; const t = (x) => +x.slice(0, 2) * 60 + +x.slice(3, 5); let d = t(b) - t(a); if (d < 0) d += 1440; return d > 720 && t(b) < t(a) ? null : d; };
// Minutes of a note's call, kept in notes.call_min for the dashboard (not written into the note text).
const callMinOf = (f) => (f && f.source === "Call" ? callMinutes(f.call_start, f.call_end) : null);
function composeNote(fields, saag, followUp) {
  const parts = [
    `DOS: ${fields.dos || "-"}`, `CLM#: ${fields.clm || "-"}`, `DENIAL: ${fields.denial || "-"}`,
    `SOURCE: ${fields.source || "-"}${fields.ref ? ", REF: " + fields.ref : (fields.source === "Call" ? ", REF: none" : "")}`,
    `PRE CALL CHECK: ${[...(fields.precheck || []), fields.precheck_text].filter(Boolean).join("; ") || "-"}`,
    `RCA/FINDINGS: ${fields.findings || "-"}`, ...limitLine(fields),
    ...(saag ? [`SAAG: ${saag.status} > ${saag.sub_status} > ${saag.action}`, `BUCKET: ${saag.bucket}`, `EFFECTIVE: ${saag.effective || "-"}`] : []),
  ];
  if (followUp) parts.push(`FOLLOW-UP: ${mmdd(followUp)}`);
  return parts.join(" | ");
}
function validateWork(payload) {
  const s = payload.saag || {};
  const saag = { status: str(s.status, 60).trim(), sub_status: str(s.sub_status, 160).trim(), action: str(s.action, 160).trim(), bucket: str(s.bucket, 20).trim(), effective: str(s.effective, 80).trim() };
  if (!saag.status || !saag.sub_status || !saag.action) throw bad("Pick the SAAG status, sub-status and action.");
  // an action that goes to Posting or Submission takes the workflow's effective status and bucket
  const routed = ROUTED_EFFECTIVE(saag.action); if (routed) { saag.effective = routed; saag.bucket = ROUTED_BUCKET[routed]; }
  if (!BUCKETS4.includes(saag.bucket)) throw bad("Pick a bucket: Payer, Client, Closed or Purview.");
  const f = payload.note || {};
  if (!commentOk(f.findings)) throw bad("Write what you found (RCA / findings), a few words at least.");
  if (f.source === "Call" && !String(f.ref || "").trim()) throw bad("A call needs its reference number (REF).");
  if (f.source === "Call" && (!hhmm(f.call_start) || !hhmm(f.call_end))) throw bad("Enter the call's start and end time.");
  if (f.source === "Call" && callMinutes(hhmm(f.call_start), hhmm(f.call_end)) == null) throw bad("The call's end time is before its start time. Check the times.");
  for (const k of ["tfl", "afl"]) if (String(f[k] == null ? "" : f[k]).trim() && !limitDays(f[k])) throw bad(`${k.toUpperCase()} must be a number of days (1 to 3650).`);
  return saag;
}
/* Entries that say an EOB is in hand, ask for posting, or file an appeal / reconsideration must carry the document:
   a file attached to the claim since its last work entry. Keep in step with ATTACH_RULE in index.html. */
const ATTACH_SUBS = /^(EOB Available|Claim Applied Towards Offset\(EOB Available\)|POTF available)$/i;
const ATTACH_ACTIONS = /^(Need to Post\/Posting Correction|Need to Appeal|Need to Appeal Mail|Appeal Sent|Paper Appeal|PLSAPPEAL|Recon\/Appeal In Process)$/i;
function attachNeeded(saag) {
  if (ATTACH_SUBS.test(saag.sub_status)) return saag.sub_status;
  if (ATTACH_ACTIONS.test(saag.action)) return saag.action;
  return "";
}
async function requireAttachment(env, claimId, saag, since) {
  const why = attachNeeded(saag);
  if (!why) return;
  const a = await one(env, "SELECT id FROM attachments WHERE claim_id = ? AND created_at > ? LIMIT 1", claimId, since || 0);
  if (!a) throw bad(`"${why}" needs the document attached (EOB, appeal or reconsideration letter). Attach it under RCA / findings, then save.`);
}
/* One line in a claim's timeline (assigned, opened, skipped, refreshed from a file, state changed, worked with what changed). */
const claimEvent = (env, claimId, user, kind, text, data) =>
  env.DB.prepare("INSERT INTO claim_events (id, claim_id, at, user_id, user_name, kind, text, data_json) VALUES (?,?,?,?,?,?,?,?)")
    .bind(uuid(), claimId, Date.now(), user ? user.id : null, user ? user.name || "" : "", kind, str(text, 500), JSON.stringify(data || {}));
const isClosedWork = (saag) => saag.bucket === "Closed" || CLOSED_EFFECTIVE.test(saag.effective);
const followUpDays = (effective, clientDays) => EFFECTIVE_DAYS[effective] || clientDays || 30;
const noteFields = (n) => { let f = {}; try { f = JSON.parse(n.fields_json || "{}"); } catch {} return f; };

/* ------------------------------------------------------------- helpers */
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new ApiError(400, m);
const denied = (m) => new ApiError(403, m || "Not allowed.");
const notFound = (m) => new ApiError(404, m || "Not found.");

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
/* Lockout: 5 wrong passwords in a row lock the account. Only a password reset with a one-time code sent to the official email
   on the account (Forgot it?), or the admin's reset, opens it again. A team lead cannot. */
const LOCK_AFTER = 5;
const LOCKED_MSG = "This account is locked after " + LOCK_AFTER + " wrong passwords. Use Forgot it? to reset your password with a code sent to your official email, or ask the admin.";
const triesLeft = (u) => { const n = LOCK_AFTER - (u.failed_logins || 0) - 1; return n + (n === 1 ? " try" : " tries") + " left before the account locks."; };
async function passwordTry(env, u, passHash) {
  if (u.locked_at) throw new ApiError(423, LOCKED_MSG);
  if (await passwordOk(env, u, passHash)) { if (u.failed_logins) await run(env, "UPDATE users SET failed_logins = 0 WHERE id = ?", u.id); return true; }
  const n = (u.failed_logins || 0) + 1;
  await run(env, "UPDATE users SET failed_logins = ?, locked_at = CASE WHEN ? >= ? THEN ? ELSE locked_at END WHERE id = ?", n, n, LOCK_AFTER, Date.now(), u.id);
  if (n >= LOCK_AFTER) throw new ApiError(423, LOCKED_MSG);
  return false;
}
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
// A real calendar date only: "2026-02-30" or "2026-13-01" would roll over in Date and give NULL in julianday().
const isoDate = (v) => { const s = String(v || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ""; const t = Date.parse(s + "T00:00:00Z"); return isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : ""; };
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
  scope_projects: jsonList(u.scope_projects_json), access_all: !!u.access_all, email_missing: !!u.email_missing, shift: u.shift || "", city: u.city || "", doj: u.doj || "", prefs: userPrefs(u.prefs_json) });
// Settings a person picks for themselves (theme, text size); unknown keys are dropped.
const PREF_KEYS = { theme: ["light", "navy", "gold", "auto"], text: ["normal", "large"], digest: ["on", "off"] };
function userPrefs(j) { let o = {}; try { o = JSON.parse(j || "{}") || {}; } catch (e) { o = {}; } const out = {}; for (const k in PREF_KEYS) if (PREF_KEYS[k].includes(o[k])) out[k] = o[k]; return out; }

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
      // closed_at: the time of the save that closed the claim (every path that closes one sets updated_at in the same statement)
      env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_claims_closed_upd AFTER UPDATE OF state ON claims FOR EACH ROW WHEN NEW.state = 'closed' AND OLD.state <> 'closed'
        BEGIN UPDATE claims SET closed_at = COALESCE(NEW.updated_at, NEW.completed_at) WHERE id = NEW.id; END`),
      env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_claims_closed_ins AFTER INSERT ON claims FOR EACH ROW WHEN NEW.state = 'closed'
        BEGIN UPDATE claims SET closed_at = COALESCE(NEW.updated_at, NEW.created_at) WHERE id = NEW.id; END`),
    ]);
    await backfillKeys(env);
    await rekeyAlt(env);
    // One SR number per client in the escalation tracker (skipped if an older database already holds a duplicate).
    try { await run(env, "CREATE UNIQUE INDEX IF NOT EXISTS idx_escalations_sr ON escalations (client_id, sr)"); } catch (e) { /* duplicates from before: keep going */ }
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
      if (!ex) await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,'admin','','',0,1,35,?)", uuid(), email, ADMIN_NAME, "Bob", "The Builder", "Admin", Date.now());
      else if (ex.role !== "admin") await run(env, "UPDATE users SET role = 'admin', active = 1 WHERE id = ?", ex.id);
      await run(env, "UPDATE users SET name = ?, first_name = 'Bob', last_name = 'The Builder' WHERE email = ? AND name IN ('Admin', '')", ADMIN_NAME, email);
    }
  })().catch((e) => { READY = null; throw e; });
  return READY;
}

/* ------------------------------------------------------------- roster */
/* The roster, straight from Purview Shastra (syncShastra); the export file upload is gone. dry_run shows what would
   change; nothing is written until it is applied. */
async function importRoster(env, user, payload) {
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
  // Two Shastra rows with the same email (or, with no email and no Emp ID, the same name) cannot both be applied:
  // they are skipped with a warning until Shastra is fixed, and nobody takes over the other's account.
  const rowMail = (row) => (mailOk(row.email) && !/\.(comcom|con)$/.test(row.email) ? row.email : placeholderEmail(row));
  const byMail = new Map(); rows.forEach((r) => { if (rosterClassify(r).reason) return; const k = rowMail(r); byMail.set(k, [...(byMail.get(k) || []), r]); });
  const claimed = new Map(), planMail = new Map();
  const skipRow = (row, match, issue) => { if (match) used.add(match.id); warnings.push({ name: row.name, emp_id: row.emp_id, project: row.project, reports_to: row.reports_to, issues: [issue], skipped: true }); };
  for (const row of rows) {
    const match0 = (row.emp_id && byEmp.get(row.emp_id.toUpperCase())) || (mailOk(row.email) && byEmail.get(row.email)) || byName.get(row.name.trim().toLowerCase()) || byEmail.get(placeholderEmail(row)) || null;
    // A name or placeholder match already taken by another row is not this person's account.
    const strong = match0 && ((row.emp_id && match0.emp_id && match0.emp_id.toUpperCase() === row.emp_id.toUpperCase()) || (mailOk(row.email) && match0.email === row.email));
    const match = match0 && claimed.has(match0.id) && !strong ? null : match0;
    const cls = rosterClassify(row, match && match.source === "roster" && match.active && match.roster_kind && match.roster_kind !== "agent" ? match.roster_kind : "");
    const twins = byMail.get(rowMail(row)) || [];
    if (!cls.reason && twins.length > 1) {
      const others = twins.filter((r) => r !== row).map((r) => r.name).join(", ");
      skipRow(row, match, mailOk(row.email) ? "skipped: the same email as " + others + " in Shastra (" + row.email + "); fix it in Shastra" : "skipped: same name as another person with no email and no Emp ID in Shastra; add an email or Emp ID in Shastra");
      continue;
    }
    if (!cls.reason && match && claimed.has(match.id)) { skipRow(row, null, "skipped: matches the same account as " + claimed.get(match.id) + "; check the Emp ID and email in Shastra"); continue; }
    if (match && !cls.reason) claimed.set(match.id, row.name);
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
      roster_status: row.status, exit_date: row.exit_date, doj: row.doj, reports_to_name: row.reports_to, projects_json: JSON.stringify(cls.projects), access_all: cls.kind === "all" ? 1 : 0, shift: row.shift, city: row.city, active: gone ? 0 : 1 };
    // An email Shastra sends is Shastra's (0). One kept from before, that Shastra does not send, counts as typed in Brahmastra (1)
    // unless the admin set it (2) or the account was made by hand and is matched now (2).
    next.email_typed = emailOk && next.email === row.email ? 0 : !match || match.email_missing ? 0 : match.email_typed === 2 || (match.source !== "roster" && match.email_typed !== 1) ? 2 : 1;
    // Last check: an email another row (or another account) already has is never written twice.
    const holderNow = byEmail.get(next.email);
    if (planMail.has(next.email) || (holderNow && (!match || holderNow.id !== match.id) && !next.free_email_from)) {
      skipRow(row, match, "skipped: the email " + next.email + " is already used by " + (planMail.get(next.email) || (holderNow && holderNow.name) || "another account") + "; fix it in Shastra");
      continue;
    }
    planMail.set(next.email, row.name);
    if (cls.unknownPos) issues.push("position not recognised (" + row.position + "): kept their current access; check it in Shastra");
    const changes = [];
    if (match) for (const k of ["name", "email", "role", "designation", "department", "roster_status", "exit_date", "doj", "reports_to_name", "projects_json", "active"]) if (String(match[k] ?? "") !== String(next[k] ?? "")) changes.push(k === "projects_json" ? "projects" : k);
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
    await run(env, `UPDATE users SET emp_id = ?, position = ?, roster_kind = ?, department = ?, departments_also = ?, roster_status = ?, exit_date = ?, doj = ?, reports_to_name = ?, projects_json = ?, access_all = ?, email_missing = ?, email_typed = ?, shift = ?, city = ? WHERE id = ?`,
      n.emp_id, n.position, n.roster_kind, n.department, n.departments_also, n.roster_status, n.exit_date, n.doj || "", n.reports_to_name, n.projects_json, n.access_all, n.email_missing, n.email_typed, n.shift, n.city, id);
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
}
/* Purview Shastra: its database answers one read-only function, brahmastra_roster(p_key), with the people list in the
   same columns as its roster export (plus DOJ). The key is the Worker secret SHASTRA_FEED_KEY; Shastra keeps only its hash.
   Runs every hour (wrangler.toml [triggers]) and from Sync now on the Roster page. Changes apply at once. */
const SHASTRA_URL_DEFAULT = "https://qhbgshnqugxqiwdywsas.supabase.co";
const SHASTRA_PUBLIC_KEY_DEFAULT = "sb_publishable_2aOo5c5pq3J33nK8hVIb0w_gjj6A4n7";   // Shastra's public (publishable) key, already in its page
async function syncShastra(env, by) {
  if (!env.SHASTRA_FEED_KEY) throw new ApiError(503, "Purview Shastra is not connected yet. Add the Worker secret SHASTRA_FEED_KEY (see the README).");
  const base = String(env.SHASTRA_URL || SHASTRA_URL_DEFAULT).replace(/\/+$/, ""), pub = env.SHASTRA_PUBLIC_KEY || SHASTRA_PUBLIC_KEY_DEFAULT;
  let r = null, data = null;
  try { r = await fetchT(base + "/rest/v1/rpc/brahmastra_roster", { method: "POST", headers: { apikey: pub, Authorization: "Bearer " + pub, "Content-Type": "application/json" }, body: JSON.stringify({ p_key: env.SHASTRA_FEED_KEY }) }); data = await r.json(); } catch {}
  if (!r || !r.ok || !data || data.ok === false) {
    const why = (data && (data.error || data.message)) || (r ? "HTTP " + r.status : "no answer");
    await setSetting(env, "shastra_sync", { at: Date.now(), ok: false, by, error: str(why, 300) });
    throw new ApiError(502, "Purview Shastra did not send the roster: " + why);
  }
  const rows = Array.isArray(data.rows) ? data.rows : [];
  // A short or empty answer is a fault on the way, not half the company leaving: nothing is applied.
  const active = await one(env, "SELECT COUNT(*) AS n FROM users WHERE source = 'roster' AND active = 1");
  if (!rows.length || (active && active.n >= 20 && rows.length < active.n * 0.5)) {
    const error = `Shastra sent ${rows.length} people while ${active ? active.n : 0} are active here, so nothing was changed.`;
    await setSetting(env, "shastra_sync", { at: Date.now(), ok: false, by, error });
    throw new ApiError(502, error);
  }
  let res;
  try { res = await importRoster(env, { name: "Purview Shastra (" + by + ")" }, { rows, file_name: "Purview Shastra", today: istISO(Date.now()) }); }
  catch (e) {
    // The Roster card shows the failure; the page gets plain words, never the database's text.
    const error = /UNIQUE|constraint/i.test(String(e && e.message)) ? "Two people in Shastra clash (the same email or Emp ID), so the roster could not be applied. Check the warnings and fix them in Shastra." : str(e && e.message, 300);
    await setSetting(env, "shastra_sync", { at: Date.now(), ok: false, by, error });
    throw e instanceof ApiError && !/UNIQUE|constraint/i.test(e.message) ? e : new ApiError(409, error);
  }
  const removed = await removeLeftovers(env);
  const sm = res.summary, now = Date.now();
  const log = (await getSetting(env, "shastra_log", [])) || [];
  if (sm.new + sm.updated + sm.deactivated || !log.length) {
    log.unshift({ at: now, by, new: sm.new, updated: sm.updated, deactivated: sm.deactivated, people: sm.people,
      names: res.people.filter((x) => x.action !== "same").slice(0, 40).map((x) => ({ name: x.name, action: x.action, changes: x.changes }))
        .concat(res.leaving.slice(0, 20).map((u) => ({ name: u.name, action: "left", changes: [] }))) });
    await setSetting(env, "shastra_log", log.slice(0, 30));
  }
  await setSetting(env, "shastra_sync", { at: now, ok: true, by, people: sm.people, new: sm.new, updated: sm.updated, deactivated: sm.deactivated, warnings: sm.warnings, removed,
    emails: res.warnings.slice(0, 200), no_access: res.excluded.length });
  try { await syncWfm(env); } catch (e) {}
  try { await syncHolidays(env); } catch (e) {}
  return { ...res, removed, synced: true };
}
/* Purview Shastra's time on the floor and idle time (dev/shastra-floor-feed.sql): brahmastra_floor(p_key, p_from, p_to)
   returns each person's days: the attendance status, time on the floor (finished shifts, breaks taken out; a shift still
   open counts up to now), time logged in, breaks, and the minutes Shastra Guard saw no movement or a locked screen while
   they were punched in (breaks left out). Team status asks for its dates; the days are kept in floor_days, a day is
   settled once fetched 12 hours after it ended, and anything newer is asked again after 10 minutes. */
const FLOOR_FRESH_MS = 10 * 60000, SH_BREAK_ALLOW_MIN = 60;
async function fetchFloor(env, from, to) {
  const base = String(env.SHASTRA_URL || SHASTRA_URL_DEFAULT).replace(/\/+$/, ""), pub = env.SHASTRA_PUBLIC_KEY || SHASTRA_PUBLIC_KEY_DEFAULT;
  let r = null, data = null;
  try { r = await fetchT(base + "/rest/v1/rpc/brahmastra_floor", { method: "POST", headers: { apikey: pub, Authorization: "Bearer " + pub, "Content-Type": "application/json" }, body: JSON.stringify({ p_key: env.SHASTRA_FEED_KEY, p_from: from, p_to: to }) }); data = await r.json(); } catch {}
  if (r && (r.status === 404 || (data && data.code === "PGRST202"))) return { ok: false, state: "not_set_up", error: "The floor-time feed is not set up in Purview Shastra yet (dev/shastra-floor-feed.sql)." };
  if (!r || !r.ok || !data || data.ok === false || !Array.isArray(data.rows)) return { ok: false, state: "error", error: str((data && (data.error || data.message)) || (r ? "HTTP " + r.status : "no answer"), 200) };
  return { ok: true, rows: data.rows };
}
async function shastraFloor(env, from, to, today, off) {
  if (!env.SHASTRA_FEED_KEY) return { state: "off", byUser: new Map() };
  const st = (await getSetting(env, "floor_sync", null)) || {};
  st.days = st.days || {};
  const now = Date.now(), last = to > today ? today : to, dayEnd = (d) => Date.parse(d + "T00:00:00Z") - off * 60000 + 86400000;
  const stale = [];
  for (let d = from; d <= last; d = addDays(d, 1)) { const at = st.days[d] || 0; if (!(at > dayEnd(d) + 12 * 3600000 || now - at < FLOOR_FRESH_MS)) stale.push(d); }
  if (stale.length && !(st.fail_at && now - st.fail_at < FLOOR_FRESH_MS)) {
    // Shastra answers at most 93 days a call (dev/shastra-floor-feed.sql): longer dates are asked in parts and the answers joined
    const a = stale[0], b = stale[stale.length - 1];
    let byEmp = null, byMail = null, unmatched = 0, failed = null;
    const n = (v) => (v == null || v === "" || !isFinite(+v) ? null : Math.max(0, Math.round(+v)));
    for (let p = a; p <= b; ) {
      const q = addDays(p, 92) < b ? addDays(p, 92) : b, res = await fetchFloor(env, p, q);
      if (!res.ok) { failed = res; break; }
      if (!byEmp) {
        byEmp = new Map(); byMail = new Map();
        for (const u of await all(env, "SELECT id, emp_id, email FROM users")) { if (u.emp_id) byEmp.set(String(u.emp_id).trim().toUpperCase(), u.id); if (u.email) byMail.set(String(u.email).trim().toLowerCase(), u.id); }
      }
      const put = [];
      for (const x of res.rows) {
        const day = isoDate(x && x.date); if (!day) continue;
        const uid = (x.emp_id && byEmp.get(String(x.emp_id).trim().toUpperCase())) || (x.email && byMail.get(String(x.email).trim().toLowerCase()));
        if (!uid) { unmatched++; continue; }
        const g = x.guard === true;
        put.push(env.DB.prepare("INSERT OR REPLACE INTO floor_days (user_id, day, status, tof_min, idle_min, locked_min, logged_min, break_min, open, guard) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(uid, day, str(x.status, 30).toLowerCase(), n(x.tof_min), g ? n(x.idle_min) : null, g ? n(x.locked_min) : null, n(x.logged_min), n(x.break_min), x.open ? 1 : 0, g ? 1 : 0));
      }
      await batchAll(env, [env.DB.prepare("DELETE FROM floor_days WHERE day BETWEEN ? AND ?").bind(p, q), ...put]);
      for (let d = p; d <= q; d = addDays(d, 1)) st.days[d] = now;
      Object.assign(st, { ok_at: now, state: "ok", unmatched });
      p = addDays(q, 1);
    }
    // when each day was fetched, for the last 120 days (or back to the dates asked for, so a long range is not asked again at once)
    const keep = addDays(today, -120) < from ? addDays(today, -120) : from; for (const d of Object.keys(st.days)) if (d < keep) delete st.days[d];
    if (failed) Object.assign(st, { fail_at: now, state: failed.state, error: failed.error });
    else Object.assign(st, { fail_at: 0, error: "" });
    await setSetting(env, "floor_sync", st);
  }
  // until the feed has answered once, there is nothing to show; after that, the kept days (with a note if the last ask failed,
  // even when its first part was answered)
  const state = st.ok_at ? "ok" : st.state || "pending";
  const byUser = new Map();
  if (state === "ok") for (const x of await all(env, "SELECT * FROM floor_days WHERE day BETWEEN ? AND ?", from, last)) { if (!byUser.has(x.user_id)) byUser.set(x.user_id, new Map()); byUser.get(x.user_id).set(x.day, x); }
  return { state, error: st.fail_at && st.fail_at >= (st.ok_at || 0) ? st.error : "", at: st.ok_at || null, byUser };
}
/* Shastra's attendance status for a day: in (a full day), a half day, unplanned (absent, sick, leave without pay),
   leave (approved, maternity, sabbatical) or off (week off, holiday, comp off: not a working day). Unknown or missing:
   Brahmastra's own Out today mark decides. Shastra still reads its older spellings "half-day" and "leave" (approved
   leave), and counts Overtime as a day at work. */
function shastraDay(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return null;
  if (["present", "late", "p", "l"].includes(s)) return { share: 1, kind: "in" };
  if (["overtime", "ot"].includes(s)) return { share: 1, kind: "in", overtime: true };
  if (["half_day", "half-day", "half_day_lwp", "hd", "hd-lwp"].includes(s)) return { share: 0.5, kind: "half" };
  if (["absent", "a", "sick_leave", "sl", "lwp"].includes(s)) return { share: 0, kind: "unplanned" };
  if (["approved_leave", "leave", "al", "maternity_leave", "ml", "sabbatical", "sb"].includes(s)) return { share: 0, kind: "leave" };
  if (["week_off", "wo", "holiday", "h", "ho", "comp_off", "co", "not_joined", "nj", "attrite", "att"].includes(s)) return { share: 0, kind: "off" };
  return null;
}
/* ---- Purview Shastra right now (dev/shastra-live-feed.sql): who is punched in, on a break, logged out, on leave or not
   in yet, kept two minutes. Brahmastra works out each person's state with Shastra's own rules: the day rolls at 05:00
   IST, late is 10 minutes past the shift start, Saturday and Sunday are the week off unless the roster says otherwise,
   and someone with no punch an hour after their shift began has not logged in (the team lead is told). ---- */
const LIVE_FRESH_MS = 2 * 60000, SH_GRACE_MS = 10 * 60000, SH_MISSING_MS = 60 * 60000;
const SH_PRESENT = new Set(["present", "late", "half_day", "half-day", "half_day_lwp", "comp_off", "overtime"]);
const SH_OFF = new Set(["approved_leave", "sick_leave", "maternity_leave", "lwp", "leave", "attrite", "sabbatical"]);
async function fetchLive(env) {
  const base = String(env.SHASTRA_URL || SHASTRA_URL_DEFAULT).replace(/\/+$/, ""), pub = env.SHASTRA_PUBLIC_KEY || SHASTRA_PUBLIC_KEY_DEFAULT;
  let r = null, data = null;
  try { r = await fetchT(base + "/rest/v1/rpc/brahmastra_live", { method: "POST", headers: { apikey: pub, Authorization: "Bearer " + pub, "Content-Type": "application/json" }, body: JSON.stringify({ p_key: env.SHASTRA_FEED_KEY }) }); data = await r.json().catch(() => null); } catch (e) { r = null; }
  if (r && (r.status === 404 || (data && data.code === "PGRST202"))) return { ok: false, state: "not_set_up", error: "The live attendance feed is not set up in Purview Shastra yet (dev/shastra-live-feed.sql)." };
  if (!r || !r.ok || !data || data.ok === false || !Array.isArray(data.rows)) return { ok: false, state: "error", error: str((data && (data.error || data.message)) || (r ? "HTTP " + r.status : "no answer"), 200) };
  return { ok: true, rows: data.rows, day: isoDate(data.day) || "" };
}
async function shastraLive(env) {
  if (!env.SHASTRA_FEED_KEY) return { state: "off", byUser: new Map(), day: "" };
  const now = Date.now();
  let st = (await getSetting(env, "live_sync", null)) || {};
  if (!(st.at && now - st.at < LIVE_FRESH_MS) && !(st.fail_at && now - st.fail_at < LIVE_FRESH_MS)) {
    const res = await fetchLive(env), ms = (v) => { const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; };
    if (res.ok) st = { at: now, day: res.day, rows: res.rows.slice(0, 5000).map((x) => ({ e: str(x.emp_id, 40), m: str(x.email, 120).toLowerCase(), s: str(x.shift, 40), st: str(x.status, 40).toLowerCase(),
      in: ms(x.in_at), out: ms(x.out_at), br: ms(x.break_since), lv: str(x.leave, 60), hol: !!x.holiday, wo: !!x.week_off, np: !!x.no_punch, ap: !!x.auto_present, lok: !!x.late_ok })) };
    else st = { ...st, fail_at: now, state: res.state, error: res.error };
    await setSetting(env, "live_sync", st);
  }
  const byUser = new Map();
  if (st.rows) {
    const byEmp = new Map(), byMail = new Map();
    for (const x of st.rows) { if (x.e) byEmp.set(x.e.trim().toUpperCase(), x); if (x.m) byMail.set(x.m.trim(), x); }
    for (const u of await all(env, "SELECT id, emp_id, email FROM users WHERE active = 1")) {
      const x = (u.emp_id && byEmp.get(String(u.emp_id).trim().toUpperCase())) || (u.email && byMail.get(String(u.email).trim().toLowerCase()));
      if (x) byUser.set(u.id, x);
    }
  }
  // Shastra failing since the last good read, for over 10 minutes: those punches are old, so they are not shown as now.
  const stale = !!(st.at && st.fail_at && st.fail_at > st.at && now - st.at > 5 * LIVE_FRESH_MS);
  return { state: stale ? "stale" : st.at ? "ok" : st.state || "pending", error: st.error || "", at: st.at || null, day: st.day || istISO(Date.now() - 5 * 3600000), byUser };
}
const hhmmIST = (ms) => new Date(ms + IST_MIN * 60000).toISOString().slice(11, 16);
const lateText = (ms) => { const m = Math.floor(ms / 60000), h = Math.floor(m / 60); return (h ? h + " h " : "") + String(m % 60).padStart(h ? 2 : 1, "0") + " m"; };
/* One person's state in Shastra now. x: their Shastra row (none when the roster does not match them); shift from Shastra, else the roster. */
function liveState(x, u, now) {
  if (!x) return { state: "none", label: "Not in Shastra", sub: "no match by Emp ID or email" };
  const L = (state, label, sub, extra) => ({ state, label, sub: sub || "", ...(extra || {}) });
  const win = shiftWindow(x.s || u.shift, now, 0);
  if (x.np) return L("offclock", "Not on the clock", "no attendance kept");
  if (x.br) return L("break", "On break", Math.max(0, Math.round((now - x.br) / 60000)) + " min", { in_at: x.in });
  if (x.in && x.out) return L("out", "Logged out", "at " + hhmmIST(x.out), { in_at: x.in });
  if (x.in) { const late = !!(win && !x.lok && x.in > win.start + SH_GRACE_MS && x.in < win.end); return L(late ? "late" : "present", late ? "Late" : "Present", "in " + hhmmIST(x.in), { in_at: x.in }); }
  if (SH_PRESENT.has(x.st)) return L("present", "Present", "marked in Shastra");
  if (SH_OFF.has(x.st) || x.lv) return L("leave", "On leave", String(x.lv || x.st).replace(/_/g, " "));
  if (x.hol) return L("leave", "Holiday", "");
  if (x.wo) return L("leave", "Week off", "");
  if (x.ap) return L("present", "Present", "contract");
  if (x.st === "absent") return L("absent", "Absent", "marked in Shastra");
  if (!win) return L("notin", "Not in yet", "no shift on the roster");
  // the business day starts at 05:00 IST: a shift that began before it and is over was yesterday's (today's is still to come)
  const istNow = now + IST_MIN * 60000, bizStart = istNow - ((istNow - 5 * 3600000) % 86400000 + 86400000) % 86400000 - IST_MIN * 60000;
  if (now >= win.end) return win.start < bizStart ? L("notin", "Not in yet", "shift " + hhmmIST(win.start)) : L("absent", "Absent", "no punch in");
  const past = now - win.start;
  if (past >= SH_MISSING_MS) return L("missing", "Not logged in", lateText(past) + " past " + hhmmIST(win.start), { since: win.start, late_min: Math.floor(past / 60000) });
  return L("notin", "Not in yet", "shift " + hhmmIST(win.start));
}
const LIVE_IN = new Set(["present", "late", "break"]);
/* The untouched claims (allocated, not started) of one biller, shared equally per client between the people on the
   client's team who are in today: logged in to Shastra (or, without Shastra, not marked out), highest priority first,
   one each in turn starting with the lightest desk. dry: only the plan. */
async function shareEqually(env, user, src, o) {
  const today = o.today || istISO(Date.now()), live = o.live || { state: "off", byUser: new Map() }, now = Date.now();
  const team = (await visibleUsers(env, user)).filter((u) => u.role === "user" && u.active && u.id !== src.id);
  const out = new Set((await all(env, "SELECT user_id FROM attendance WHERE day IN (?, ?) AND status = 'out'", today, live.day || today)).map((x) => x.user_id));
  const stateOf = (u) => liveState(live.byUser.get(u.id), u, now).state;
  const isIn = (u) => !out.has(u.id) && (live.state !== "ok" || LIVE_IN.has(stateOf(u)) || stateOf(u) === "none");
  const why = (u) => out.has(u.id) ? "out today" : ({ leave: "on leave", missing: "not logged in", notin: "not in yet", absent: "absent", out: "logged out", offclock: "not on the clock" })[stateOf(u)] || "not in";
  const claims = await all(env, `SELECT id, client_id, priority, tier FROM claims WHERE assigned_to = ? AND state = 'assigned'${editScopeSql(user, "client_id")} ORDER BY priority DESC`, src.id, ...editScopeArgs(user));
  const ids = [...new Set(claims.map((c) => c.client_id))];
  const cls = ids.length ? await all(env, `SELECT id, name, team_json FROM clients WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const load = new Map((await all(env, "SELECT assigned_to, COUNT(*) AS n FROM claims WHERE state IN ('assigned','in_progress') AND assigned_to IS NOT NULL GROUP BY assigned_to")).map((x) => [x.assigned_to, x.n]));
  const given = new Map(), moves = [], skipped = new Map(), perClient = [];
  let left = 0;
  for (const c of cls) {
    const mine = claims.filter((x) => x.client_id === c.id), on = new Set(parseTeam(c.team_json));
    const members = team.filter((u) => on.has(u.id)), cands = members.filter(isIn);
    members.filter((u) => !isIn(u)).forEach((u) => skipped.set(u.id, { name: u.name, why: why(u) }));
    if (!cands.length) { left += mine.length; perClient.push({ id: c.id, name: c.name, n: mine.length, left: mine.length }); continue; }
    // each claim to whoever has been given the fewest so far (across every client), then the lightest desk
    const gn = (u) => (given.get(u.id) || {}).count || 0;
    for (const x of mine) {
      const u = cands.reduce((m, v) => (gn(v) - gn(m) || (load.get(v.id) || 0) - (load.get(m.id) || 0) || v.name.localeCompare(m.name)) < 0 ? v : m);
      moves.push({ claim: x.id, to: u }); given.set(u.id, { id: u.id, name: u.name, count: gn(u) + 1 });
    }
    perClient.push({ id: c.id, name: c.name, n: mine.length, left: 0 });
  }
  const res = { n: claims.length, high: claims.filter((x) => x.tier === "High").length, moved: moves.length, left, to: [...given.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    skipped: [...skipped.values()], clients: perClient };
  if (o.dry || !moves.length) return res;
  const stmts = [];
  for (const m of moves) {
    stmts.push(env.DB.prepare("UPDATE claims SET assigned_to = ?, assigned_at = ?, updated_at = ? WHERE id = ? AND state = 'assigned' AND assigned_to = ?").bind(m.to.id, now, now, m.claim, src.id));
    stmts.push(claimEvent(env, m.claim, user, "assigned", m.to.name, { from: src.name, via: o.via || "rebalance" }));
  }
  await batchAll(env, stmts, 50);
  await noticeAlloc(env, res.to.map((x) => [x.id, x.count]), (n) => `${n} new claim${n === 1 ? " was" : "s were"} allocated to you: from ${src.name}'s desk (${o.reason || "not in today"}), shared equally by ${user.name || "your team lead"}.`);
  return res;
}
/* "N new claims were allocated to you": a notice on the biller's screen, in the bell and on their computer. */
async function noticeAlloc(env, pairs, textOf) {
  const now = Date.now(), stmts = pairs.filter(([, n]) => n > 0).map(([uid, n]) => env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id, kind) VALUES (?,?,?,?,?,?,?)").bind(uuid(), uid, now, str(textOf(n), 300), "queue", null, "alloc"));
  if (stmts.length) await batchAll(env, stmts, 50);
}
/* The billers a supervisor should hear about: no punch in Shastra an hour after their shift began, not marked out,
   not dismissed today. popup: the person's own team lead, or a team lead of a client they are on (managers, the VP and
   admins see it in the bell). */
async function missingAlerts(env, user) {
  if (user.role !== "supervisor") return { state: "off", alerts: [] };
  const live = await shastraLive(env);
  if (live.state !== "ok") return { state: live.state, alerts: [] };
  const now = Date.now(), day = live.day, today = istISO(now);
  const team = (await visibleUsers(env, user)).filter((u) => u.role === "user" && u.active && (!String(u.department || "").trim() || isAR(u)));
  const out = new Set((await all(env, "SELECT user_id FROM attendance WHERE day IN (?, ?) AND status = 'out'", today, day)).map((x) => x.user_id));
  const marks = await all(env, "SELECT user_id, by_id, state, until_at FROM shastra_alerts WHERE day = ?", day);
  const gone = new Set(marks.filter((m) => m.state === "dismissed").map((m) => m.user_id));
  const snoozed = new Set(marks.filter((m) => m.state === "snoozed" && m.by_id === user.id && m.until_at > now).map((m) => m.user_id));
  const missing = team.filter((u) => !out.has(u.id) && !gone.has(u.id)).map((u) => ({ u, s: liveState(live.byUser.get(u.id), u, now) })).filter((x) => x.s.state === "missing");
  if (!missing.length) return { state: "ok", alerts: [] };
  const clients = await all(env, "SELECT id, team_json FROM clients WHERE active = 1");
  const alerts = [];
  for (const { u, s } of missing) {
    const plan = await shareEqually(env, user, u, { dry: true, live, today });
    const leadsClient = clients.some((c) => parseTeam(c.team_json).includes(u.id) && leadFor(user, c.id));
    alerts.push({ user_id: u.id, name: u.name, shift: u.shift || "", day, since: s.since, late_min: s.late_min, sub: s.sub, n: plan.n, high: plan.high, plan: plan.to, skipped: plan.skipped,
      left: plan.left, clients: plan.clients.map((c) => c.name), popup: (u.reports_to === user.id || (leadsClient && !isManagerUp(user))) && !snoozed.has(u.id), snoozed: snoozed.has(u.id) });
  }
  return { state: "ok", alerts };
}
/* How many times a claim came back to AR from Posting / Submission / Rejections (Back to AR or Need assistance). */
async function returnsOf(env, claimId) {
  const r = await one(env, "SELECT COUNT(*) AS n FROM handoffs WHERE claim_id = ? AND status IN ('back','assistance')", claimId);
  return (r && r.n) || 0;
}
/* People an old roster file brought in who are not in Shastra: switched off by the sync, and removed here when they
   never signed in and have nothing on any claim. Anyone with work in Brahmastra stays (switched off) for the history. */
async function removeLeftovers(env) {
  const gone = await all(env, `SELECT id FROM users u WHERE u.source = 'roster' AND u.active = 0 AND u.role <> 'admin' AND u.last_login IS NULL AND COALESCE(u.pass_hash, '') = ''
    AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.user_id = u.id) AND NOT EXISTS (SELECT 1 FROM claim_events e WHERE e.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.user_id = u.id) AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.assigned_to = u.id OR c.last_worked_by = u.id)
    AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.lead_id = u.id OR h.backup_id = u.id OR h.assigned_to = u.id OR h.done_by = u.id)
    AND NOT EXISTS (SELECT 1 FROM allocations l WHERE l.by_user = u.id)`);
  if (!gone.length) return 0;
  await batchAll(env, gone.flatMap((u) => [env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id), env.DB.prepare("DELETE FROM users WHERE id = ?").bind(u.id)]), 40);
  return gone.length;
}
/* The client report's inventory at a day: live claims when the day is today (or later), else the snapshot kept that day
   (or up to 3 days before), else rebuilt from the claims' history: on file by that day and not closed or excluded yet then. */
/* Where the claims open at the end of the period before went during this one (Client 360's inventory page), each claim once,
   by its latest step. Purview's workflow: AR's part is done when AR closes a claim (paid, adjusted, written off, closed in a
   file) or sends it for posting; Posting completing it closes it (then only QA is left). A claim sent to Submission is never
   closed: it is pending with the desk, then comes back to AR for its follow-up (15 days or a month), the 48-hour recheck and
   rejections. Excluded: taken off the inventory. Back on a biller's list counts as nothing. */
const CR_MOVES = [["ar_close", "AR close"], ["pending_posting", "AR close · sent to Posting"], ["posting_close", "Posting close"], ["pending_submission", "Pending Submission"],
  ["submission_close", "Submission close · AR follow-up"], ["excluded", "Excluded"]];
async function crMovement(env, clientId, loc, t0, t1) {
  if (!(t1 > t0)) return [];
  const lw = loc ? " AND c.location_id = ?" : "", la = loc ? [loc] : [];
  const evs = await all(env, `SELECT e.claim_id, e.at, json_extract(e.data_json, '$.changes.state[1]') AS to_state FROM claim_events e JOIN claims c ON c.id = e.claim_id
      WHERE c.client_id = ?${lw} AND c.created_at <= ? AND e.at > ? AND e.at <= ? AND json_extract(e.data_json, '$.changes.state[1]') IS NOT NULL LIMIT 60000`, clientId, ...la, t0, t0, t1);
  const hos = await all(env, `SELECT h.claim_id, h.dept, h.status, h.created_at, h.done_at FROM handoffs h JOIN claims c ON c.id = h.claim_id
      WHERE h.client_id = ?${lw} AND c.created_at <= ? AND h.dept IN ('posting','submission','rejection')
        AND ((h.created_at > ? AND h.created_at <= ?) OR (h.done_at > ? AND h.done_at <= ?)) LIMIT 60000`, clientId, ...la, t0, t0, t1, t0, t1);
  // each claim's latest step in a list of events and hand-offs: a category, or null (back in AR)
  const steps = (evRows, hoRows, lo, hi) => {
    const last = new Map(), put = (id, at, k) => { const x = last.get(id); if (!x || at >= x.at) last.set(id, { at, k }); };
    for (const e of evRows) if (e.at > lo && e.at <= hi && e.to_state !== "in_process") put(e.claim_id, e.at, e.to_state === "closed" ? "ar_close" : e.to_state === "excluded" ? "excluded" : null);
    for (const h of hoRows) {
      const desk = h.dept === "posting" ? "posting" : "submission";
      if (h.created_at > lo && h.created_at <= hi) put(h.claim_id, h.created_at, "pending_" + desk);
      if (h.done_at && h.done_at > lo && h.done_at <= hi) put(h.claim_id, h.done_at, h.status === "complete" ? desk + "_close" : null);
    }
    return last;
  };
  const last = steps(evs, hos, t0, t1);
  // only the claims that were in the open AR at the end of the period before: their latest step until then left them in AR
  const outAtStart = new Set();
  for (const part of chunks([...last.keys()], 80)) {
    const q = part.map(() => "?").join(",");
    const ev0 = await all(env, `SELECT claim_id, at, json_extract(data_json, '$.changes.state[1]') AS to_state FROM claim_events WHERE claim_id IN (${q}) AND at <= ? AND json_extract(data_json, '$.changes.state[1]') IS NOT NULL`, ...part, t0);
    const ho0 = await all(env, `SELECT claim_id, dept, status, created_at, done_at FROM handoffs WHERE claim_id IN (${q}) AND dept IN ('posting','submission','rejection') AND created_at <= ?`, ...part, t0);
    for (const [id, x] of steps(ev0, ho0, -1, t0)) if (x.k && x.k !== "submission_close") outAtStart.add(id);
  }
  const ids = [...last.entries()].filter(([id, x]) => x.k && !outAtStart.has(id)).map(([id]) => id), bal = new Map();
  for (const part of chunks(ids, 80)) (await all(env, `SELECT id, balance FROM claims WHERE id IN (${part.map(() => "?").join(",")})`, ...part)).forEach((r) => bal.set(r.id, Number(r.balance) || 0));
  return CR_MOVES.map(([k, label]) => { const xs = ids.filter((id) => last.get(id).k === k); return { k, label, n: xs.length, amt: Math.round(xs.reduce((t, id) => t + (bal.get(id) || 0), 0) * 100) / 100 }; });
}
async function crInventory(env, clientId, loc, day, today) {
  const lw = loc ? " AND c.location_id = ?" : "", la = loc ? [loc] : [];
  if (day >= today) {
    const rows = await all(env, `SELECT c.id, c.claim_no, c.account_no, c.dos, c.age_days, c.payer, c.balance, c.billed, c.last_status_code AS st, c.file_status AS pms,
        CASE WHEN c.last_sub_status <> '' THEN c.last_sub_status ELSE c.file_sub_status END AS sub, CASE WHEN c.last_action_code <> '' THEN c.last_action_code ELSE c.file_action END AS act,
        c.last_bucket AS mv, COALESCE(c.location_id, '') AS loc, c.last_worked_on AS wd, u.name AS by_name
      FROM claims c LEFT JOIN users u ON u.id = c.last_worked_by WHERE c.client_id = ? AND c.state IN ${WORKABLE}${lw} LIMIT 60000`, clientId, ...la);
    return { as_of: today, source: "live", rows: rows.map((r) => { const age = crAge(r.dos, r.age_days, today); return { id: r.id, no: r.claim_no || r.account_no || "", dos: r.dos || "", py: r.payer || "",
      amt: Number(r.balance) || 0, chg: r.billed == null ? null : Number(r.billed), age, bk: crBucket(age), st: r.st || "", pms: r.pms || "", sub: r.sub || "", act: r.act || "", mv: r.mv || "",
      loc: r.loc, wd: r.wd || "", by: r.by_name || "" }; }) };
  }
  const snap = await one(env, "SELECT day, cells_json FROM inv_snapshots WHERE client_id = ? AND day <= ? AND day >= ? ORDER BY day DESC LIMIT 1", clientId, day, addDays(day, -3));
  if (snap) { let cells = []; try { cells = JSON.parse(snap.cells_json); } catch {} return { as_of: snap.day, source: "snapshot", cells: loc ? cells.filter((x) => x.loc === loc) : cells }; }
  const end = Date.parse(day + "T00:00:00Z") - IST_MIN * 60000 + 86400000 - 1;
  // when a claim left AR: the state change that closed or excluded it, else the hand-off to a desk (in process, or closed by
  // a posting), else the work that closed it; a claim closed with no such record came in closed (it never was open AR)
  const rows = await all(env, `WITH lv AS (SELECT e.claim_id, MAX(e.at) AS left_at FROM claim_events e JOIN claims c ON c.id = e.claim_id
        WHERE c.client_id = ? AND c.state IN ('closed', 'excluded') AND json_extract(e.data_json, '$.changes.state[1]') IN ('closed', 'excluded') GROUP BY e.claim_id),
      ho AS (SELECT h.claim_id, MAX(h.created_at) AS sent_at FROM handoffs h WHERE h.client_id = ? GROUP BY h.claim_id)
      SELECT ${CR_CELL_COLS} FROM claims c LEFT JOIN lv ON lv.claim_id = c.id LEFT JOIN ho ON ho.claim_id = c.id
      WHERE c.client_id = ? AND c.created_at <= ?${lw} AND (c.state IN ${WORKABLE}
        OR (c.state = 'in_process' AND COALESCE(ho.sent_at, c.updated_at) > ?)
        OR (c.state IN ('closed', 'excluded') AND COALESCE(lv.left_at, CASE WHEN c.state_reason = 'Payment posted' THEN ho.sent_at END, c.completed_at, c.created_at) > ?)) LIMIT 60000`,
    clientId, clientId, clientId, end, ...la, end, end);
  return { as_of: day, source: "rebuilt", cells: crCells(rows, day) };
}
/* ------------------------------------------------------------- auth */
async function userFromToken(env, token) {
  if (!token) return null;
  const row = await one(env, "SELECT s.expires_at AS s_exp, s.via AS s_via, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", token);
  if (!row) return null;
  const now = Date.now();
  if (row.s_exp < now || !row.active) { await run(env, "DELETE FROM sessions WHERE token = ?", token); return null; }
  if (row.s_exp - now < SESSION_KEEP_MS) await run(env, "UPDATE sessions SET expires_at = ? WHERE token = ?", now + SESSION_MS, token);
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
const ADMIN_NAME = "Bob The Builder";
const adminEmails = (env) => String(env.ADMIN_EMAILS || "").split(",").map(mailClean).filter(mailOk);
/* ---- team today: shifts ----
   "18:30-03:30" (IST) and the like. The shift a person is in now (or last started) runs from its latest start at or
   before now; without a shift, the day starts at local midnight and lasts nine hours from the first entry. */
/* A shift that crosses midnight (18:30 to 03:30, 22:30 to 07:30): its hours and entries belong to the day it started. That day
   runs on past midnight to an hour and a half after the shift ends, and never ends before 05:00 IST (the working day rolls then,
   as My day and Shastra count it): 05:00 for 18:30 to 03:30, 09:00 for 22:30 to 07:30. dayRollMin: the minutes after IST midnight
   at which the person's working day rolls over (0 for a day shift or no shift). */
function dayRollMin(shift) {
  const m = String(shift || "").match(/(\d{1,2})[:.](\d{2})\s*[-–to]+\s*(\d{1,2})[:.](\d{2})/i);
  if (!m) return 0;
  const start = Number(m[1]) * 60 + Number(m[2]), end = Number(m[3]) * 60 + Number(m[4]);
  return end < start ? Math.min(start, Math.max(300, end + 90)) : 0;
}
/* The working day a person is in at now (today: the IST date of now): a night shift still under way after midnight (or within
   its hour and a half after) is still the day before. from / to: that day's bounds; shift: that day's shift, when the roster
   has one. */
function workDayOf(shift, now, today, off = IST_MIN) {
  const roll = dayRollMin(shift), todayStart = Date.parse(today + "T00:00:00Z") - off * 60000;
  const day = roll && now >= todayStart && now < todayStart + roll * 60000 ? addDays(today, -1) : today;
  const dayStart = Date.parse(day + "T00:00:00Z") - off * 60000, from = dayStart + roll * 60000;
  const m = String(shift || "").match(/(\d{1,2})[:.](\d{2})\s*[-–to]+\s*(\d{1,2})[:.](\d{2})/i);
  let sh = null;
  if (m) { const s = Number(m[1]) * 60 + Number(m[2]), e = Number(m[3]) * 60 + Number(m[4]), len = ((e - s + 1440) % 1440 || 1440) * 60000;
    const start = dayStart + s * 60000; sh = { start, end: start + len, len }; }
  return { day, from, to: from + 86400000, roll, shift: sh };
}
/* A working day for targets: Monday to Friday, not a Shastra holiday. */
const isWorkDay = (iso) => { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6 && !HOLIDAYS.has(iso); };
/* A follow-up date that falls on a Saturday, Sunday or Shastra holiday moves to the next working day. */
function workingDayOnOrAfter(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return iso || "";
  let d = iso; for (let i = 0; i < 30 && !isWorkDay(d); i++) d = addDays(d, 1);
  return d;
}
function shiftWindow(shift, now, dayStart) {
  const m = String(shift || "").match(/(\d{1,2})[:.](\d{2})\s*[-–to]+\s*(\d{1,2})[:.](\d{2})/i);
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[2]), endMin = Number(m[3]) * 60 + Number(m[4]);
  const len = ((endMin - startMin + 1440) % 1440 || 1440) * 60000;
  const ist = now + IST_MIN * 60000, midnight = ist - (ist % 86400000);
  let start = midnight + startMin * 60000 - IST_MIN * 60000;
  if (start > now) start -= 86400000;
  return { start, end: start + len, len };
}
/* ---- audit trail: who changed access, RACI, recipients, client settings, roles ----
   Also who got a sign-in code or set a password for someone else, email and Emp ID changes, accounts added and deleted, the extra
   sign-in emails and roster projects matched to clients. Never a code, a password or a token: only who, whom and when. */
async function audit(env, user, action, clientId, detail) {
  try { await run(env, "INSERT INTO audit_log (id, at, user_id, user_name, action, client_id, detail) VALUES (?,?,?,?,?,?,?)", uuid(), Date.now(), (user && user.id) || null, (user && user.name) || "", str(action, 60), clientId || null, str(detail, 400)); } catch (e) {}
}
/* ---- client health (Client 360, portfolio) ---- */
const OVER90_TARGET = 15;   // % of AR over 90 days that counts as healthy
const CALL_LOG_MAX = 2000;  // characters in one client call log entry (the page counts them as they are typed)
const MONTHEND_STEPS = [
  ["inventory", "Inventory uploaded", 1, true], ["internal", "Internal reports reviewed", 2, false], ["sla_inventory", "AR Inventory sent to the SLA scorecard", 2, true],
  ["pack", "Client pack built", 3, false], ["sla", "SLA scored and reasons noted", 4, false], ["sent", "Pack sent to the client", 5, false]];   // key, label, due (working day of next month), can tick by itself
/* ---- The Monday digest: one email per manager's span (their clients), to every supervisor on those clients ----
   Spans are the managers from the roster (roster_kind manager) and the clients their projects map to, the same as
   Portfolio › Managers side by side. Active clients in no span go in one more email, "clients without a manager".
   Who gets a span's email: its manager, and the active team leads, SMEs, desk leads, the VP and admins who are on
   any of its clients (not view-only shares), with an email address and the digest not turned off in Settings.
   Clients, staff and figures only: no patient names, claim or account numbers. Sent on Monday mornings (IST) by
   the scheduled job, a few spans per run. */
const DIGEST_SYSTEM = { id: "system", name: "Brahmastra", email: "", role: "supervisor", is_admin: true, scope: null, scope_view_only: new Set() };
const DIGEST_HOURS = [8.5, 13];   // IST, Monday
const DIGEST_CRON = "*/10 3-7 * * 1";   // wrangler.toml: every 10 minutes, Monday 03:00 to 07:50 UTC (08:30 to 13:20 IST)
const NO_SPAN = "span:none";
function digestWeek(now) {
  const t = istISO(now), dow = new Date(t + "T00:00:00Z").getUTCDay();
  const monday = new Date(Date.parse(t + "T00:00:00Z") - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
  const to = Date.parse(monday + "T00:00:00Z") - IST_MIN * 60000;
  return { week: monday, from: to - 7 * 86400000, to, first: new Date(to - 7 * 86400000 + IST_MIN * 60000).toISOString().slice(0, 10), last: new Date(to - 86400000 + IST_MIN * 60000).toISOString().slice(0, 10) };
}
async function digestPeople(env) {
  const rows = await all(env, "SELECT * FROM users WHERE active = 1 AND role IN ('supervisor', 'admin')");
  const out = [];
  for (const r of rows) {
    const u = publicUser(r);
    if (!u.email || u.email_missing || !/@/.test(u.email)) continue;
    u.scope = await scopeOf(env, u);
    out.push(u);
  }
  return out;
}
const onClient = (u, clientId) => u.is_admin || u.access_all || canEditClient(u, clientId);
/* The spans, each with its clients and who gets its email. */
async function digestSpans(env, people) {
  const clients = await all(env, "SELECT id, name, roster_names_json FROM clients WHERE active = 1 ORDER BY name");
  const mgrs = await all(env, "SELECT id, name, email, scope_projects_json FROM users WHERE active = 1 AND roster_kind = 'manager' AND access_all = 0 ORDER BY name");
  const spans = [], placed = new Set();
  for (const m of mgrs) {
    const names = new Set(jsonList(m.scope_projects_json).map(projKey));
    const mine = clients.filter((c) => jsonList(c.roster_names_json).some((n) => names.has(projKey(n))));
    if (!mine.length) continue;
    mine.forEach((c) => placed.add(c.id));
    spans.push({ key: "span:" + m.id, manager: { id: m.id, name: m.name }, title: m.name + "'s clients", clients: mine.map((c) => ({ id: c.id, name: c.name })) });
  }
  const rest = clients.filter((c) => !placed.has(c.id));
  if (rest.length) spans.push({ key: NO_SPAN, manager: null, title: "Clients without a manager", clients: rest.map((c) => ({ id: c.id, name: c.name })) });
  for (const s of spans) {
    s.recipients = people.filter((u) => (s.manager && u.id === s.manager.id) || s.clients.some((c) => onClient(u, c.id)))
      .filter((u) => s.key !== NO_SPAN || u.is_admin || u.access_all || s.clients.some((c) => canEditClient(u, c.id)));
  }
  return spans;
}
/* A team lead sees only their own clients of a manager's digest; the manager, the admin and people with every client see it all. */
const spanFor = (user, s) => (user.is_admin || user.access_all || (s.manager && s.manager.id === user.id)) ? s : { ...s, clients: s.clients.filter((c) => onClient(user, c.id)) };
const spanVisible = (user, s) => user.is_admin || user.access_all || (s.manager && s.manager.id === user.id) || s.recipients.some((u) => u.id === user.id);
async function digestData(env, clientId, wk) {
  const today = istISO(wk.to);
  const o = await OPS["client.overview"]({ env, user: DIGEST_SYSTEM, payload: { client_id: clientId, from_ms: wk.from, to_ms: wk.to, today, tz_offset_min: IST_MIN } });
  // a week before: AR at the end of the Sunday before the digest week (so the week's own Monday counts in the change)
  const weekAgo = await one(env, "SELECT ar_balance, over90_balance FROM client_snapshots WHERE client_id = ? AND day <= ? ORDER BY day DESC LIMIT 1", clientId, istISO(wk.from - 1));
  // a past week's digest: AR as it stood at that week's end (the day's snapshot), not today's
  const endSnap = digestWeek(Date.now()).week === wk.week ? null
    : await one(env, "SELECT day, ar_balance, over90_balance, ar_owed, over90_owed FROM client_snapshots WHERE client_id = ? AND day <= ? ORDER BY day DESC LIMIT 1", clientId, istISO(wk.to - 1));
  const prevWorked = await one(env, "SELECT COUNT(*) AS n FROM notes n JOIN claims c ON c.id = n.claim_id WHERE c.client_id = ? AND n.kind = 'work' AND n.created_at BETWEEN ? AND ?", clientId, wk.from - 7 * 86400000, wk.from);
  const people = await all(env, `SELECT n.user_name AS name, SUM(n.kind = 'work') AS work, SUM(n.kind = 'skip') AS skips FROM notes n JOIN claims c ON c.id = n.claim_id
    WHERE c.client_id = ? AND n.kind IN ('work', 'skip') AND n.created_at BETWEEN ? AND ? GROUP BY n.user_id ORDER BY work DESC LIMIT 12`, clientId, wk.from, wk.to);
  const esc = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND escalated_at BETWEEN ? AND ?", clientId, wk.from, wk.to);
  return {
    client: o.client, health: o.health, reasons: o.reasons,
    // that week's money owed (credits left out); a reading kept before the money owed was kept falls back to the net figures
    ar: endSnap ? (() => { const owed = endSnap.ar_owed != null ? endSnap.ar_owed : endSnap.ar_balance, o90 = endSnap.over90_owed != null ? endSnap.over90_owed : endSnap.over90_balance;
        return { now: endSnap.ar_balance, over90: o90, week_ago: weekAgo ? weekAgo.ar_balance : null, over90_pct: owed ? Math.round(o90 / owed * 1000) / 10 : 0, target: o.ar.target, owed, over90_owed: o90, as_of: endSnap.day }; })()
      : { now: o.ar.balance, over90: o.ar.over90, week_ago: weekAgo ? weekAgo.ar_balance : null, over90_pct: o.ar.over90_pct, target: o.ar.target, owed: o.ar.owed || 0, over90_owed: o.ar.over90_owed || 0 },
    collected: o.collected, worked: { n: o.worked.entries, people: o.worked.people, prev: (prevWorked && prevWorked.n) || 0 }, team: people,
    sla: o.sla, escalations: { open: o.escalations.open, late: o.escalations.late, raised: (esc && esc.n) || 0 }, missed: o.missed,
    waiting: { n: o.waiting.rows.length, balance: o.waiting.balance, oldest: o.waiting.oldest }, tfl: o.tfl, denials: o.reasons_top,
    monthend: { month: o.monthend.month, done: o.monthend.done, total: o.monthend.steps.length, late: o.monthend.steps.filter((s) => !s.done && s.due < today).map((s) => s.label) },
  };
}
const dMoney = (n) => (n == null ? "–" : "$" + Math.round(Number(n)).toLocaleString("en-US"));
const dDay = (iso) => { const [, m, d] = iso.split("-").map(Number); return MONTHS[m - 1].slice(0, 3) + " " + d; };
const HEALTH_LOOK = { good: ["On track", "#0E8C74", "#E3F4EF"], watch: ["Watch", "#9A6A12", "#FBF0DC"], risk: ["At risk", "#A32D2D", "#FBE5E5"] };
/* The SLA report card at the top of the digest: each client's last finished month in Drishti (green 90% and above, amber 80 to 89,
   red under 80), worst first, with its team leads and SMEs, the scopes and what pulls it down. Clients Drishti has no month for
   are named at the end. */
/* What the email and the digest dashboard both show: the span's totals, what needs attention and the good news. */
function digestRollup(ds) {
  const sum = (f) => ds.reduce((t, d) => t + (f(d) || 0), 0);
  // over 90 is of the money owed (credit balances left out), as on each client's card
  const ar = sum((d) => d.ar.now), o90 = sum((d) => d.ar.over90), owed = sum((d) => d.ar.owed || 0), pct = owed ? Math.round(sum((d) => d.ar.over90_owed || 0) / owed * 1000) / 10 : 0;
  const withAgo = ds.filter((d) => d.ar.week_ago != null), agoNow = withAgo.reduce((t, d) => t + d.ar.now, 0), ago = withAgo.reduce((t, d) => t + d.ar.week_ago, 0);
  const count = { risk: 0, watch: 0, good: 0 }; ds.forEach((d) => { count[d.health] = (count[d.health] || 0) + 1; });
  const scored = ds.filter((d) => d.card), bands = { ok: 0, warn: 0, miss: 0 }; scored.forEach((d) => { bands[d.card.band] = (bands[d.card.band] || 0) + 1; });
  const es = ds.filter((d) => d.esc), et = (f) => es.reduce((t, d) => t + (d.esc[f] || 0), 0);
  const attention = [];
  for (const d of ds) {
    // the SLA line names the two worst KPIs, so one line says it all
    const worst = d.card && d.card.band !== "ok" && d.card.drags.length ? "worst: " + d.card.drags.slice(0, 2).map((i) => `${i.name} ${i.shown}${i.target ? " (" + i.target + ")" : ""}`).join(", ") : "";
    let slaSaid = false;
    // with Drishti's card for the month, its score is the one named (not a month-end score typed in): one SLA figure per client
    d.reasons.forEach((r) => { if (d.card && /\bSLA \d/.test(r.text)) return; const isSla = /\bSLA\b/.test(r.text) && worst && !slaSaid; if (isSla) slaSaid = true; attention.push([r.tone, d.client.name, isSla ? r.text + "; " + worst : r.text]); });
    if (d.card && d.card.band !== "ok" && !slaSaid) attention.push([d.card.band === "miss" ? "red" : "amber", d.client.name, `SLA ${d.card.score}% for ${d.card.period.label} (${d.card.band === "miss" ? "red" : "amber"})` + (worst ? "; " + worst : "")]);
    if (d.esc && d.esc.over24) attention.push([d.esc.over24 > d.esc.over24_reason ? "red" : "amber", d.client.name, `${d.esc.over24} escalation${d.esc.over24 > 1 ? "s" : ""} open over 24 h` + (d.esc.over24_reason ? ` (${d.esc.over24_reason} with a reason)` : ", no reason yet")]);
    if (d.monthend.late.length) attention.push(["amber", d.client.name, `month-end for ${monthName(d.monthend.month)} past due: ${d.monthend.late.join(", ")}`]);
    const m = d.missed.ar + d.missed.posting + d.missed.submission;
    if (m && !d.reasons.some((r) => /missed/.test(r.text))) attention.push(["amber", d.client.name, `${m} missed task${m > 1 ? "s" : ""}`]);
  }
  attention.sort((a, b) => (a[0] === "red" ? 0 : 1) - (b[0] === "red" ? 0 : 1));
  const good = [];
  for (const d of ds) {
    if (d.ar.week_ago != null && d.ar.now < d.ar.week_ago - 1) good.push([d.ar.week_ago - d.ar.now, `${d.client.name}: AR down ${dMoney(d.ar.week_ago - d.ar.now)}`]);
    if (d.collected.amount > d.collected.prev && d.collected.amount > 0) good.push([d.collected.amount, `${d.client.name} collected ${dMoney(d.collected.amount)}, more than the week before`]);
  }
  good.sort((a, b) => b[0] - a[0]);
  const tat = Object.fromEntries(TAT_PARTS.map(([k]) => { const xs = ds.map((d) => d.tat && d.tat.parts.find((p) => p.k === k)).filter(Boolean), due = xs.reduce((t, x) => t + x.due, 0), met = xs.reduce((t, x) => t + x.met, 0);
    return [k, due ? { due, met, pct: Math.round(met / due * 1000) / 10 } : null]; }));
  for (const d of ds) if (d.turn90 && d.turn90.n) attention.push([d.ar.over90_pct > d.ar.target ? "red" : "amber", d.client.name, `${d.turn90.n} ${d.turn90.n === 1 ? "claim" : "claims"} (${dMoney(d.turn90.bal)}) turn 90 in the next 7 days: work them first`]);
  for (const d of ds) if (d.tat && d.tat.worst) attention.push([d.tat.worst.missed > 2 ? "red" : "amber", d.client.name, `TAT last week: ${d.tat.worst.missed} missed at ${d.tat.worst.label}` + (d.tat.worst.who ? `, ${d.tat.worst.who_n} with ${d.tat.worst.who}` : "")]);
  attention.sort((a, b) => (a[0] === "red" ? 0 : 1) - (b[0] === "red" ? 0 : 1));
  return { ar, o90, pct, tat, target: ds.length ? ds[0].ar.target : OVER90_TARGET, ar_ago: withAgo.length ? agoNow - ago : null, coll: sum((d) => d.collected.amount), coll_prev: sum((d) => d.collected.prev),
    work: sum((d) => d.worked.n), work_prev: sum((d) => d.worked.prev), count, bands, sla_avg: scored.length ? Math.round(scored.reduce((t, d) => t + d.card.score, 0) / scored.length) : null,
    sla_month: scored.length && scored.every((d) => d.card.period.label === scored[0].card.period.label) ? scored[0].card.period.label : "", esc: es.length ? { n: et("n"), internal: et("internal"), open: et("open"), over24: et("over24"), over24_reason: et("over24_reason"), errors: et("errors"), month: monthLabel(es[0].esc.from.slice(0, 7)) } : null,
    attention, good: good.map((g) => g[1]) };
}
/* One client's TAT for the digest: each part's % within TAT, and the part missed most with the person most of it sat with. */
const TAT_PARTS = [["posting", "Payment posting"], ["submission", "Submission"], ["attention", "Needs attention"]];
function tatDigest(t) {
  if (!t) return null;
  const parts = TAT_PARTS.map(([k, label]) => ({ k, label, due: t[k].due, met: t[k].met, missed: t[k].missed, pct: t[k].pct })).filter((x) => x.due);
  if (!parts.length) return null;
  const w = [...parts].filter((x) => x.missed).sort((a, b) => b.missed - a.missed)[0] || null;
  const whoList = w && t[w.k].who ? Object.entries(t[w.k].who).sort((a, b) => b[1] - a[1]) : [];
  return { parts, worst: w ? { label: w.label, missed: w.missed, who: whoList.length ? whoList[0][0] : "", who_n: whoList.length ? whoList[0][1] : 0 } : null };
}
const tatLine = (t) => t ? t.parts.map((x) => `${x.label} ${x.pct}% (${x.met} of ${x.due})`).join(" · ") + (t.worst ? ` · most missed: ${t.worst.label}, ${t.worst.missed}` + (t.worst.who ? ` (${t.worst.who_n} with ${t.worst.who})` : "") : "") : "";
// worst first: red SLA, then amber, green, then clients Drishti has not scored, by health
const digestOrder = (ds) => [...ds].sort((a, b) => (a.card ? a.card.score : 999) - (b.card ? b.card.score : 999) || ({ risk: 0, watch: 1, good: 2 }[a.health] - { risk: 0, watch: 1, good: 2 }[b.health]));
const BAND_LOOK = { ok: ["Green", "#127A4D", "#E3F5EC", "#1A9E6A"], warn: ["Amber", "#935300", "#FDF0D7", "#E8A13C"], miss: ["Red", "#BA2340", "#FDE7EB", "#C94F4F"] };
const dShort = (n) => (n == null ? "–" : Math.abs(n) >= 1e6 ? "$" + (Math.round(n / 1e4) / 100) + "M" : Math.abs(n) >= 1e4 ? "$" + Math.round(n / 1e3) + "K" : dMoney(n));
/* The Monday email: short, in plain tables that hold up in Outlook and on a phone, with a button to the full digest dashboard
   in Brahmastra (landscape, every detail). Clients, staff and figures only: no patient names, claim or account numbers. */
function spanEmail(span, wk, ds, appUrl, extra = {}) {
  const R = digestRollup(ds), order = digestOrder(ds);
  const weekTxt = `${dDay(wk.first)} to ${dDay(wk.last)}`;
  const link = appUrl ? appUrl.replace(/\/+$/, "") + "/#/digest?span=" + encodeURIComponent(span.key || "") + "&week=" + wk.week : "";
  const wf = ds.filter((d) => d.wfm), wsum = (f) => wf.reduce((t, d) => t + (d.wfm[f] || 0), 0);
  const teamLine = wf.length ? `Billable FTE: <b>${wf.some((d) => d.wfm.billable != null) ? fteTxt(wsum("billable")) : "–"}</b> · Assign FTE: <b>${fteTxt(wsum("assigned_fte"))}</b>` : "";
  const bandTxt = R.sla_avg != null ? [R.bands.ok && R.bands.ok + " green", R.bands.warn && R.bands.warn + " amber", R.bands.miss && R.bands.miss + " red"].filter(Boolean).join(" · ") : ["risk", "watch", "good"].filter((k) => R.count[k]).map((k) => R.count[k] + " " + HEALTH_LOOK[k][0].toLowerCase()).join(" · ");
  const hrow = (k, v) => `<tr><td style="padding:1px 14px 1px 0;color:#C9D6E2">${k}</td><td style="color:#FFFFFF">${v}</td></tr>`;
  const box = (v, label, color) => `<td width="25%" style="border:1px solid #DFE4EA;padding:8px 10px;vertical-align:top"><div style="font-size:20px;font-weight:bold;color:${color || "#0F1B24"}">${v}</div><div style="color:#627079;font-size:11px">${label}</div></td>`;
  const tag = (txt, look) => `<span style="background:${look[2]};color:${look[1]};font-weight:bold;padding:2px 7px;white-space:nowrap">${txt}</span>`;
  const cell = (x, align, extraStyle) => `<td align="${align || "left"}" style="padding:8px 4px;border-bottom:1px solid #EEF1F4;vertical-align:middle${extraStyle || ""}">${x}</td>`;
  const row = (d) => {
    const ppl = [d.tls.length ? (d.tls.length > 1 ? "TLs " : "TL ") + d.tls.join(", ") : "", d.smes.length ? (d.smes.length > 1 ? "SMEs " : "SME ") + d.smes.join(", ") : ""].filter(Boolean).join(" · ");
    const sla = d.card ? tag(`${d.card.score}%${d.card.delta ? (d.card.delta > 0 ? " ▲" : " ▼") + Math.abs(d.card.delta) : ""}`, BAND_LOOK[d.card.band]) : `<span style="color:#627079">not scored</span>`;
    const esc = d.esc ? tag((d.esc.n ? `${d.esc.n} ext · ${d.esc.open ? d.esc.open + " open" : "closed"}` : "0 ext") + ` · ${d.esc.internal || 0} int`, BAND_LOOK[d.esc.n ? "miss" : "ok"]) : "–";
    return `<tr>${cell(`<b>${htmlEsc(d.client.name)}</b>${ppl ? `<div style="color:#627079;font-size:11px">${htmlEsc(ppl)}</div>` : ""}`)}${cell(sla, "center")}${cell(esc, "center")}${cell(d.wfm ? `${fteTxt(d.wfm.billable)} / ${fteTxt(d.wfm.assigned_fte)}` : "–", "center")}${cell(d.ar.over90_pct + "%", "right", d.ar.over90_pct > d.ar.target ? ";color:#BA2340" : "")}</tr>`;
  };
  const hcell = (x, align) => `<td align="${align || "left"}" style="padding:6px 4px;border-bottom:2px solid #DFE4EA;color:#627079;font-size:11px"><b>${x}</b></td>`;
  const sec = (t) => `<tr><td style="padding:14px 22px 4px"><div style="font-size:11px;letter-spacing:1px;color:#627079;font-weight:bold">${t}</div></td></tr>`;
  const html = `<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #DFE4EA;font-family:Segoe UI,Arial,sans-serif;color:#0F1B24">
<tr><td style="background:#0B2740;padding:16px 22px;color:#FFFFFF">
<div style="font-size:11px;letter-spacing:1px;color:#9FD9C9;font-weight:bold">BRAHMASTRA · MONDAY DIGEST</div>
<div style="font-size:19px;font-weight:bold;margin:4px 0 8px;color:#FFFFFF">${htmlEsc(span.title)} · week of ${weekTxt}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px">${hrow("Manager name", extra.manager ? `<b>${htmlEsc(extra.manager.name)}</b>` : "No manager (VP and admins)")}${hrow("Designation", extra.manager ? htmlEsc(extra.manager.designation) : "–")}${hrow("Period", "Week of " + weekTxt)}${hrow("Clients", `<b>${ds.length}</b>${bandTxt ? " · " + bandTxt : ""}`)}${teamLine ? hrow("Total team", teamLine) : ""}</table></td></tr>
<tr><td style="padding:16px 22px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px"><tr>
${box(R.sla_avg == null ? "–" : R.sla_avg + "%", "avg SLA score" + (R.sla_month ? " · " + htmlEsc(R.sla_month.slice(0, 3)) : ""))}${box(R.esc ? R.esc.n + " · " + (R.esc.internal || 0) : "–", `external · internal escalations ${R.esc ? htmlEsc(R.esc.month.slice(0, 3)) + " " : ""}· target ${ESC_SLA_TARGET}`, R.esc && R.esc.n ? "#BA2340" : "#127A4D")}${box(dShort(R.ar), "AR" + (R.ar_ago != null ? (R.ar_ago <= 0 ? " · down " : " · up ") + dShort(Math.abs(R.ar_ago)) : ""))}${box(R.pct + "%", "over 90 · target " + R.target + "%", R.pct > R.target ? "#BA2340" : "#0F1B24")}
</tr></table></td></tr>
${sec("CLIENT BY CLIENT")}
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px;border-collapse:collapse">
<tr>${hcell("Client")}${hcell("SLA", "center")}${hcell("Escalations<br>external · internal", "center")}${hcell("Billable / Assign FTE", "center")}${hcell("Over 90", "right")}</tr>
${order.map(row).join("")}</table></td></tr>
${ds.some((d) => d.tat) ? sec("TAT LAST WEEK · WORKING HOURS, MONDAY TO FRIDAY") + `<tr><td style="padding:0 22px;font-size:12.5px;line-height:1.6">` +
  TAT_PARTS.filter(([k]) => R.tat[k]).map(([k, label]) => `<span style="white-space:nowrap;margin-right:12px">${label}: <b style="color:${R.tat[k].pct >= 100 ? "#127A4D" : R.tat[k].pct >= 90 ? "#935300" : "#BA2340"}">${R.tat[k].pct}%</b> <span style="color:#627079">(${R.tat[k].met} of ${R.tat[k].due})</span></span>`).join("") +
  order.filter((d) => d.tat).map((d) => `<div style="margin-top:3px"><b>${htmlEsc(d.client.name)}</b>: ${htmlEsc(tatLine(d.tat))}</div>`).join("") + `</td></tr>` : ""}
${sec("NEEDS YOUR ATTENTION")}
<tr><td style="padding:0 22px;font-size:13px;line-height:1.6">${R.attention.length ? R.attention.slice(0, 5).map(([t, c, x]) => `<div><span style="color:${t === "red" ? "#C94F4F" : "#E8A13C"}">●</span> <b>${htmlEsc(c)}</b>: ${htmlEsc(x)}</div>`).join("") + (R.attention.length > 5 ? `<div style="color:#627079;font-size:12px">and ${R.attention.length - 5} more on the dashboard</div>` : "") : `<div style="color:#627079">Nothing needs you this week.</div>`}
${R.good.length ? `<div style="color:#127A4D;margin-top:4px">Good news: ${htmlEsc(R.good.slice(0, 2).join("; "))}.</div>` : ""}</td></tr>
${link ? `<tr><td style="padding:16px 22px 4px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0E8C74;padding:9px 16px"><a href="${htmlEsc(link)}" style="color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:13px">Open the full digest in Brahmastra →</a></td></tr></table>
<div style="font-size:11.5px;color:#627079;margin-top:6px">Every client's scorecard, Billable and Assign FTE, what pulls it down and the escalations, on one landscape page. Download it as a PDF from there.</div></td></tr>` : ""}
<tr><td style="padding:14px 22px 16px;font-size:11.5px;color:#627079">You get this because you are a supervisor on ${span.manager ? htmlEsc(span.title.replace(/'s clients$/, "")) + "'s clients" : "clients without a manager"} in Brahmastra. Turn it off in Brahmastra, Settings, Email. Clients, staff and figures only: no patient names, claim or account numbers.</td></tr>
</table>`;
  const text = [`Brahmastra Monday digest: ${span.title}, week of ${weekTxt}`,
    `Manager name: ${extra.manager ? extra.manager.name : "No manager"} · Designation: ${extra.manager ? extra.manager.designation : "-"} · Period: week of ${weekTxt}`,
    ...(wf.length ? [`Total team: Billable FTE: ${fteTxt(wsum("billable"))} · Assign FTE: ${fteTxt(wsum("assigned_fte"))}`] : []),
    `AR ${dMoney(R.ar)}, over 90 ${R.pct}% (target ${R.target}%)` + (R.sla_avg != null ? `, average SLA ${R.sla_avg}%` : "") + (R.esc ? `, escalations ${R.esc.n} external (target ${ESC_SLA_TARGET}) and ${R.esc.internal || 0} internal` : ""), "", "Client by client:",
    ...order.map((d) => `- ${d.client.name}: SLA ${d.card ? d.card.score + "% (" + BAND_LOOK[d.card.band][0].toLowerCase() + ")" : "not scored"}` + (d.esc ? `, escalations ${d.esc.n} external and ${d.esc.internal || 0} internal` : "") + (d.wfm ? `, Billable FTE ${fteTxt(d.wfm.billable)}, Assign FTE ${fteTxt(d.wfm.assigned_fte)}` : "") + `, over 90 ${d.ar.over90_pct}%`),
    ...(ds.some((d) => d.tat) ? ["", "TAT last week (working hours, Monday to Friday):", ...TAT_PARTS.filter(([k]) => R.tat[k]).map(([k, label]) => `- ${label}: ${R.tat[k].pct}% (${R.tat[k].met} of ${R.tat[k].due})`),
      ...order.filter((d) => d.tat).map((d) => `- ${d.client.name}: ${tatLine(d.tat)}`)] : []),
    "", "Needs your attention:", ...(R.attention.length ? R.attention.slice(0, 5).map(([, c, x]) => `- ${c}: ${x}`) : ["- Nothing needs you."]), "",
    ...(link ? ["Open the full digest: " + link, ""] : []), "Turn this off in Brahmastra, Settings, Email."].join("\n");
  const subject = `${span.title} · week of ${dDay(wk.first)}: ${R.count.risk ? R.count.risk + " at risk, " : ""}AR ${dMoney(R.ar)}${R.attention.length ? ", " + R.attention.length + " to look at" : ""}`;
  return { subject, html, text };
}
async function spanData(env, span, wk) {
  const ds = []; for (const c of span.clients) ds.push(await digestData(env, c.id, wk));
  // the header: the manager, their designation; each client's team leads and SMEs; each client's SLA report card from Drishti
  const mgr = span.manager ? await one(env, "SELECT name, designation, position FROM users WHERE id = ?", span.manager.id) : null;
  const people = await digestPeople(env);
  const isMgr = (u) => u.is_admin || u.access_all || u.roster_kind === "manager";
  // the escalation box is a month (the SLA KPI): the month to date at the week's end; a week that starts in the month before
  // (the Monday after a month ends) shows that month in full, so no escalation falls between two digests
  const cross = wk.first.slice(0, 7) !== wk.last.slice(0, 7);
  const escFrom = (cross ? wk.first : wk.last).slice(0, 8) + "01";
  const escTo = cross ? new Date(Date.parse(nextMonthISO(wk.first.slice(0, 7)) + "-01T00:00:00Z") - 86400000).toISOString().slice(0, 10) : wk.last;
  for (const d of ds) {
    const on = people.filter((u) => !isMgr(u) && u.role === "supervisor" && canEditClient(u, d.client.id));
    d.smes = on.filter((u) => isSME(u)).map((u) => u.name).sort();
    d.tls = on.filter((u) => !isSME(u)).map((u) => u.name).sort();
    let sc = null; try { sc = await OPS["sla.scorecard"]({ env, user: DIGEST_SYSTEM, payload: { client_id: d.client.id, kind: "month", today: istISO(wk.to) } }); } catch (e) { sc = null; }
    // the digest scores months only: a client with only weeks in Drishti is "not scored" here, not a week under the month
    d.card = sc && sc.state === "ok" && sc.score != null && sc.period && sc.period.kind === "month" ? sc : null;
    d.esc = await escSummary(env, d.client.id, escFrom, escTo, wk.to);
  }
  const wfm = await clientWfm(env, ds.map((d) => d.client.id)); ds.forEach((d) => { d.wfm = wfm.get(d.client.id) || null; });
  // turning 90 in the next 7 days, on the latest digest only (an older week's claims have moved on since): work them first
  const dIds = ds.map((d) => d.client.id), ref = istISO(Date.now());
  if (dIds.length && wk.week === digestWeek(Date.now()).week) {
    const t9 = new Map((await all(env, `SELECT client_id, COUNT(*) AS n, COALESCE(SUM(balance), 0) AS bal FROM (SELECT c.client_id, c.balance, ${AGE_SQL("c.")} AS age FROM claims c
        WHERE c.client_id IN (${dIds.map(() => "?").join(",")}) AND c.state IN ${WORKABLE} AND c.balance > 0) WHERE age BETWEEN 84 AND 90 GROUP BY client_id`, ref, ...dIds)).map((r) => [r.client_id, r]));
    for (const d of ds) d.turn90 = t9.get(d.client.id) || null;
  }
  // TAT last week: Payment posting, Submission and Needs attention, and where it was missed most (no claim numbers in the digest)
  const ts = await tatStats(env, ds.map((d) => d.client.id), wk.from, wk.to);
  for (const d of ds) d.tat = tatDigest(ts.get(d.client.id));
  return { ds, manager: mgr ? { name: mgr.name, designation: mgr.designation || mgr.position || "Manager" } : null };
}
async function spanMail(env, span, wk) {
  const { ds, manager } = await spanData(env, span, wk);
  return spanEmail(span, wk, ds, env.APP_URL || "", { manager });
}
/* Sends this week's digest for up to `limit` spans that have not had it yet. Each person gets each span once a week. */
async function sendDigests(env, { now = Date.now(), limit = 3, spanKey = null, by = "Monday job" } = {}) {
  const wk = digestWeek(now);
  // a span is done for the week once a run sent it with no failure; a span whose sends failed is tried again on the next run
  // (only the people it failed for), after the spans that have not been tried yet
  const runs = new Map((await all(env, "SELECT client_id, failed FROM digest_runs WHERE week = ?", wk.week)).map((r) => [r.client_id, r.failed]));
  const people = await digestPeople(env);
  const spans = (await digestSpans(env, people)).filter((s) => (spanKey ? s.key === spanKey : !(runs.has(s.key) && !runs.get(s.key))))
    .sort((a, b) => (runs.has(a.key) ? 1 : 0) - (runs.has(b.key) ? 1 : 0));
  let sent = 0, failed = 0, n = 0;
  for (const s of spans.slice(0, limit)) {
    n++;
    const to = s.recipients.filter((u) => (u.prefs || {}).digest !== "off");
    const already = new Set((await all(env, "SELECT user_id FROM digest_log WHERE week = ? AND client_id = ? AND ok = 1", wk.week, s.key)).map((r) => r.user_id));
    // one email per set of clients: the manager's whole span, or a team lead's own clients only
    const mails = new Map(), mailFor = async (u) => { const su = spanFor(u, s), k = su.clients.map((c) => c.id).join(","); if (!mails.has(k)) mails.set(k, su.clients.length ? await spanMail(env, su, wk) : null); return mails.get(k); };
    let ok = 0, bad = 0;
    for (const u of to.filter((x) => !already.has(x.id))) {
      const mail = await mailFor(u); if (!mail) continue;
      // claim this person's send first (ok = 2, sending), so two runs at once never both send it; a claim left by a run
      // that died is taken over after 30 minutes
      const t0 = Date.now();
      const claim = await run(env, `INSERT INTO digest_log (week, client_id, user_id, name, email, at, ok, error) VALUES (?,?,?,?,?,?,2,'')
        ON CONFLICT (week, client_id, user_id) DO UPDATE SET at = excluded.at, ok = 2, error = '' WHERE digest_log.ok = 0 OR (digest_log.ok = 2 AND digest_log.at < ?)`,
        wk.week, s.key, u.id, u.name || "", u.email, t0, t0 - 30 * 60000);
      if (!changesOf(claim)) continue;
      let err = "";
      try { await sendEmail(env, { to: u.email, subject: mail.subject, text: mail.text, html: mail.html }); ok++; } catch (e) { err = String((e && e.message) || e).slice(0, 300); bad++; }
      await run(env, "UPDATE digest_log SET at = ?, ok = ?, error = ? WHERE week = ? AND client_id = ? AND user_id = ?", Date.now(), err ? 0 : 1, err, wk.week, s.key, u.id);
    }
    await run(env, `INSERT INTO digest_runs (week, client_id, at, sent, failed, by_name) VALUES (?,?,?,?,?,?)
      ON CONFLICT (week, client_id) DO UPDATE SET at = excluded.at, sent = digest_runs.sent + excluded.sent, failed = excluded.failed, by_name = excluded.by_name`, wk.week, s.key, Date.now(), ok, bad, by);
    sent += ok; failed += bad;
  }
  return { week: wk.week, spans: n, sent, failed, left: Math.max(0, spans.length - n) };
}
function digestDue(now) {
  const d = new Date(now + IST_MIN * 60000), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return d.getUTCDay() === 1 && h >= DIGEST_HOURS[0] && h < DIGEST_HOURS[1];
}
/* Today's AR per client, kept once a day (the last write of the day wins), for the six-month trend. The money owed (credits left out)
   and its over-90 part are kept too: the trend's over-90 share is of the money owed, as on the Dashboard and Client 360. */
async function snapshotClients(env) {
  const now = Date.now(), day = istISO(now), today = day;
  await run(env, `INSERT INTO client_snapshots (client_id, day, ar_balance, ar_claims, over90_balance, over90_claims, over120_balance, ar_owed, over90_owed, at)
    SELECT client_id, ?, COALESCE(SUM(balance), 0), COUNT(*), COALESCE(SUM(CASE WHEN age > 90 THEN balance ELSE 0 END), 0), SUM(CASE WHEN age > 90 THEN 1 ELSE 0 END),
      COALESCE(SUM(CASE WHEN age > 120 THEN balance ELSE 0 END), 0), COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN age > 90 AND balance > 0 THEN balance ELSE 0 END), 0), ?
    FROM (SELECT client_id, balance, CASE WHEN dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN COALESCE(julianday(?) - julianday(substr(dos, 1, 10)), age_days) ELSE age_days END AS age
          FROM claims WHERE state IN ${WORKABLE}) GROUP BY client_id
    ON CONFLICT (client_id, day) DO UPDATE SET ar_balance = excluded.ar_balance, ar_claims = excluded.ar_claims, over90_balance = excluded.over90_balance,
      over90_claims = excluded.over90_claims, over120_balance = excluded.over120_balance, ar_owed = excluded.ar_owed, over90_owed = excluded.over90_owed, at = excluded.at`, day, now, today);
  // A client whose last claims closed still gets today's row (nothing open; a client with no claims yet gets none), so an older snapshot is not read as today's.
  await run(env, `INSERT INTO client_snapshots (client_id, day, ar_balance, ar_claims, over90_balance, over90_claims, over120_balance, ar_owed, over90_owed, at)
    SELECT id, ?, 0, 0, 0, 0, 0, 0, 0, ? FROM clients WHERE active = 1 AND id IN (SELECT client_id FROM claims) AND id NOT IN (SELECT client_id FROM claims WHERE state IN ${WORKABLE})
    ON CONFLICT (client_id, day) DO UPDATE SET ar_balance = 0, ar_claims = 0, over90_balance = 0, over90_claims = 0, over120_balance = 0, ar_owed = 0, over90_owed = 0, at = excluded.at`, day, now);
  await snapshotInventory(env, day, now);
}
/* The client report's month against month needs the inventory as it stood at each period end: kept here as cells (location,
   age group, payer, status, PMS status, action: claims and balance). The last write of the day wins. Days older than 45 are
   pruned except month ends and Sundays (week ends). */
// the age groups Purview uses: one top group, 360 plus (the AR production file's groups too)
const CR_BUCKETS = [[30, "0-30"], [60, "31-60"], [90, "61-90"], [120, "91-120"], [180, "121-180"], [360, "181-360"], [Infinity, "360+"]];
const crBucket = (age) => (age == null || !isFinite(age) ? "" : age < 0 ? "future" : CR_BUCKETS.find(([hi]) => age <= hi)[1]);
function crAge(dos, ageDays, dayISO) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(dos || ""));
  if (m) return Math.round((Date.parse(dayISO + "T00:00:00Z") - Date.parse(m[1] + "T00:00:00Z")) / 86400000);   // below 0: a DOS in the future
  return ageDays == null ? null : Number(ageDays);
}
function crCells(rows, dayISO) {
  const m = new Map();
  for (const r of rows) {
    const bk = crBucket(crAge(r.dos, r.age_days, dayISO));
    const e = { loc: r.loc || "", bk, py: r.payer || "", st: r.st || "", pms: r.pms || "", act: r.act || "" };
    const key = [e.loc, e.bk, e.py, e.st, e.pms, e.act].join("\u0001");
    const x = m.get(key) || { ...e, n: 0, amt: 0 }; x.n++; x.amt += Number(r.balance) || 0; m.set(key, x);
  }
  return [...m.values()].map((x) => ({ ...x, amt: Math.round(x.amt * 100) / 100 }));
}
const CR_CELL_COLS = `COALESCE(c.location_id, '') AS loc, c.dos, c.age_days, c.payer, c.last_status_code AS st, c.file_status AS pms,
  CASE WHEN c.last_action_code <> '' THEN c.last_action_code ELSE c.file_action END AS act, c.balance`;
async function snapshotInventory(env, day, now) {
  const rows = await all(env, `SELECT c.client_id, ${CR_CELL_COLS} FROM claims c WHERE c.state IN ${WORKABLE}`);
  const by = new Map(); for (const r of rows) { if (!by.has(r.client_id)) by.set(r.client_id, []); by.get(r.client_id).push(r); }
  // Active clients with nothing workable get an empty day too.
  for (const c of await all(env, "SELECT id FROM clients WHERE active = 1 AND id IN (SELECT client_id FROM claims)")) if (!by.has(c.id)) by.set(c.id, []);
  const stmts = [...by].map(([cid, rs]) => env.DB.prepare(`INSERT INTO inv_snapshots (client_id, day, cells_json, at) VALUES (?,?,?,?)
    ON CONFLICT (client_id, day) DO UPDATE SET cells_json = excluded.cells_json, at = excluded.at`).bind(cid, day, JSON.stringify(crCells(rs, day)), now));
  stmts.push(env.DB.prepare(`DELETE FROM inv_snapshots WHERE day < ? AND strftime('%d', day, '+1 day') <> '01' AND strftime('%w', day) <> '0'`).bind(addDays(day, -45)));
  await batchAll(env, stmts, 40);
}
async function snapshotIfStale(env) {
  const last = await getSetting(env, "snap_at", 0);
  if (Date.now() - (Number(last) || 0) < 3600000) return;
  await setSetting(env, "snap_at", Date.now());
  await snapshotClients(env);
}
/* Missed tasks per client: AR = allocated before today and still not worked; posting / submission = past the 24-hour
   TAT, still open or finished late in the last 30 days. */
async function missedByClient(env, payload) {
  const now = Date.now(), since = now - 30 * 86400000;
  const t = isoDate(payload && payload.today), off = Math.round(num(payload && payload.tz_offset_min, IST_MIN));
  const dayStart = t ? Date.parse(t + "T00:00:00Z") - off * 60000 : Date.parse(istISO(now) + "T00:00:00Z") - IST_MIN * 60000;
  const out = new Map(); const get = (id) => { if (!out.has(id)) out.set(id, { ar: 0, posting: 0, submission: 0 }); return out.get(id); };
  for (const r of await all(env, `SELECT client_id, COUNT(*) AS n FROM claims WHERE state IN ('assigned','in_progress') AND assigned_at IS NOT NULL AND assigned_at < ? GROUP BY client_id`, dayStart)) get(r.client_id).ar = r.n;
  for (const r of await all(env, `SELECT client_id, CASE WHEN dept = 'posting' THEN 'posting' ELSE 'submission' END AS grp, COUNT(*) AS n FROM handoffs
      WHERE ((status IN ('pending','assigned','client') AND due_at < ?) OR (done_at IS NOT NULL AND done_at > due_at AND done_at >= ?)) GROUP BY client_id, grp`, now, since)) get(r.client_id)[r.grp] = r.n;
  return out;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym) => { const [y, m] = String(ym || "").split("-").map(Number); return m >= 1 && m <= 12 ? MONTHS[m - 1] + " " + y : String(ym || ""); };
/* Health of a client from its numbers: plain reasons, worst first, and a verdict (good / watch / risk). */
/* "Escalations" everywhere a client is scored means the client's escalations in the Escalation tracker (logged by SMEs and above):
   open ones, and those open over 24 hours with no reason given yet. A biller flagging a claim for their team lead is Needs attention,
   counted apart, never as an escalation. */
async function trackerEsc(env, clientId) {
  const late = subWorkingHours(Date.now(), ESC_TAT_HOURS);
  const rows = await all(env, `SELECT client_id, COUNT(*) AS n, SUM(CASE WHEN created_at < ? AND delay_reason = '' THEN 1 ELSE 0 END) AS late FROM escalations
    WHERE status != 'resolved' AND kind <> 'internal'${clientId ? " AND client_id = ?" : ""} GROUP BY client_id`, late, ...(clientId ? [clientId] : []));
  return new Map(rows.map((r) => [r.client_id, { n: r.n || 0, late: r.late || 0 }]));
}
function healthOf({ pct, sla, tfl, escLate, waitingN, oldest, missed }) {
  const out = [];
  if (pct > OVER90_TARGET) out.push({ tone: pct > OVER90_TARGET + 5 ? "red" : "amber", text: `Over-90 AR is ${pct}%, above the ${OVER90_TARGET}% target` });
  if (sla && sla.score < 90) out.push({ tone: sla.score < 80 ? "red" : "amber", text: `SLA ${sla.score}% for ${monthName(sla.month)}, below 90%` });
  if (tfl && tfl.past_n) out.push({ tone: "red", text: `${tfl.past_n} claim${tfl.past_n > 1 ? "s are" : " is"} past the timely filing limit` });
  else if (tfl && tfl.soon_n) out.push({ tone: "amber", text: `${tfl.soon_n} claim${tfl.soon_n > 1 ? "s reach" : " reaches"} the timely filing limit in 30 days` });
  if (escLate) out.push({ tone: "red", text: `${escLate} client escalation${escLate > 1 ? "s are" : " is"} open over 24 hours with no reason given` });
  if (waitingN && oldest >= 5) out.push({ tone: "amber", text: `${waitingN} request${waitingN > 1 ? "s" : ""} waiting on the client, oldest ${oldest} days` });
  if (missed >= 10) out.push({ tone: "amber", text: `${missed} missed tasks` });
  out.sort((a, b) => (a.tone === "red" ? 0 : 1) - (b.tone === "red" ? 0 : 1));
  return { health: !out.length ? "good" : out.some((r) => r.tone === "red") ? "risk" : "watch", reasons: out };
}
/* The month being closed: last month during the first 10 days of a month, else this month. */
/* A real month (01 to 12), from 2000 up to this month: a typed "2026-13" or "2099-12" would become the client's latest SLA. */
const okMonth = (m, todayIso) => typeof m === "string" && /^(\d{4})-(0[1-9]|1[0-2])$/.test(m) && m >= "2000-01" && m <= String(todayIso || isoToday()).slice(0, 7);
const closingMonth = (todayIso) => { const [y, m, d] = todayIso.split("-").map(Number); if (d > 10) return `${y}-${String(m).padStart(2, "0")}`; const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return `${py}-${String(pm).padStart(2, "0")}`; };
/* The n-th working day (Mon to Fri) of the month after `month` (YYYY-MM). */
function nthWorkingDayAfter(month, n) {
  const [y, m] = month.split("-").map(Number);
  let d = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)), k = 0;
  for (;;) { const w = d.getUTCDay(), iso = d.toISOString().slice(0, 10); if (w !== 0 && w !== 6 && !HOLIDAYS.has(iso)) { k++; if (k === n) return iso; } d = new Date(d.getTime() + 86400000); }
}
async function monthendAuto(env, clientId, month, step, byName) {
  await run(env, `INSERT INTO client_monthend (client_id, month, step, done_at, done_by_name, auto) VALUES (?,?,?,?,?,1)
    ON CONFLICT (client_id, month, step) DO NOTHING`, clientId, month, step, Date.now(), byName || "by itself");
}
/* ---- feedback ---- */
const FEEDBACK_KINDS = { bug: "Something is wrong", idea: "I have an idea", praise: "This helped me" };
const FEEDBACK_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/;
/* Who gets feedback: the admin's pick, else the active Shreya and Sweety (team leads and up first). */
async function feedbackRecipients(env) {
  const users = await all(env, "SELECT id, name, email, role, email_missing FROM users WHERE active = 1 ORDER BY name");
  const set = await getSetting(env, "feedback_to", null);
  if (Array.isArray(set) && set.length) { const picked = users.filter((u) => set.includes(u.id)); if (picked.length) return picked; }
  const first = (u) => String(u.name || "").trim().split(/\s+/)[0].toLowerCase();
  const pick = (n) => { const m = users.filter((u) => first(u) === n); const lead = m.filter((u) => u.role !== "user"); return lead.length ? lead : m; };
  return [...pick("shreya"), ...pick("sweety")];
}
async function isFeedbackReader(env, user) { return !!user && (user.is_admin || (await feedbackRecipients(env)).some((u) => u.id === user.id)); }
async function feedbackReader(env, user) { if (!(await isFeedbackReader(env, user))) throw denied("The feedback inbox is for the people the feedback goes to."); }
const htmlEsc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function feedbackHtml({ kind, message, page, user, files, ctx, at }) {
  const row = (k, v) => v ? `<tr><td style="padding:3px 12px 3px 0;color:#627079;white-space:nowrap">${k}</td><td style="padding:3px 0">${htmlEsc(v)}</td></tr>` : "";
  return `<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#0F1B24;max-width:640px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0E8C74;font-weight:700">Brahmastra feedback</div>
<h2 style="margin:4px 0 12px;font-size:20px">${htmlEsc(FEEDBACK_KINDS[kind] || kind)}</h2>
<div style="white-space:pre-wrap;background:#F5F7F9;border:1px solid #DFE4EA;border-radius:8px;padding:12px 14px">${htmlEsc(message)}</div>
<table style="margin-top:14px;font-size:13px;border-collapse:collapse">${row("From", (user.name || "") + " <" + (user.email || "") + ">")}${row("Page", page)}${row("When", new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC")}${row("Version", ctx.version)}${row("Screen", ctx.screen)}${row("Browser", ctx.agent)}</table>
<p style="font-size:13px;color:#3B4A55">${files.length ? files.length + " file" + (files.length > 1 ? "s" : "") + " attached: " + files.map((f) => htmlEsc(f.name)).join(", ") + "." : "No files attached."} It is also in the Feedback inbox in Brahmastra (Manage › Feedback).</p></div>`;
}
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

/* Sign-in by name keeps the same email allow-list as sign-in by email. Someone with no email at all (a roster placeholder) is let
   through: a code from their team lead is how they sign in. */
async function nameSignInOk(env, u) { if (u.email_missing) return; const block = await signInBlock(env, u); if (block) throw new ApiError(403, block); }

const andList = (xs) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);
const namesOf = async (env, ids) => { const u = [...new Set(ids.filter(Boolean))]; return new Map(u.length ? (await all(env, `SELECT id, name FROM users WHERE id IN (${u.map(() => "?").join(",")})`, ...u)).map((r) => [r.id, r.name]) : []); };
/* Open hand-offs follow a new posting / submission / rejections person or follow-up checker: the ones waiting on the client too
   (they are still open: the new person sees them under Waiting on client and resumes them when the client answers). */
async function followHandoffs(env, clientId, dept, lead, backup) {
  if (dept === "subcheck") { if (lead) await run(env, "UPDATE handoffs SET lead_id = ?, assigned_to = ? WHERE client_id = ? AND dept = 'subcheck' AND status IN ('pending','assigned','client')", lead, lead, clientId); return; }
  if (lead && dept !== "ar") await run(env, "UPDATE handoffs SET lead_id = ?, backup_id = ? WHERE client_id = ? AND dept = ? AND status IN ('pending','assigned','client')", lead, backup || null, clientId, dept);
}
/* A client profile from the setup form: scope of work, a daily target and a responsible person for each, who
   rechecks submissions. Everything is required; the message lists what is missing. */
// Payment posting, Submission and Rejections have no daily target: they work what is sent to them, within the TAT.
const NO_TARGET = new Set(["posting", "submission", "rejection"]);
async function checkProfile(env, p, { isNew, locations }) {
  p = p || {};
  const scope = SERVICES.map(([k]) => k).filter((k) => Array.isArray(p.scope) && p.scope.includes(k));
  const resp = p.resp || {}, miss = [], cols = {}, targets = {}, ids = [];
  if (!scope.length) miss.push("the scope of work");
  if (!locations) miss.push("at least one location");
  for (const [s] of SERVICES) {
    const [m, l, b] = RESP_COLS[s];
    if (scope.includes(s)) {
      // AR has a daily target; Payment posting, Submission and Rejections work to the TAT instead.
      if (!NO_TARGET.has(s)) { const t = Math.round(num(p.targets && p.targets[s], 0));
        if (t < 1 || t > 5000) miss.push(`a daily target for ${SERVICE_NAME[s]}`); else targets[s] = t; }
      const lead = str(resp[s] && resp[s].lead, 60), backup = str(resp[s] && resp[s].backup, 60);
      if (!lead) miss.push(`who is responsible for ${SERVICE_NAME[s]}`);
      cols[m] = "person"; cols[l] = lead || null; cols[b] = backup && backup !== lead ? backup : null;
      ids.push(lead, cols[b]);
    } else { cols[m] = s === "ar" || s === "rejection" ? "" : "client"; cols[l] = null; cols[b] = null; }
  }
  // The TAT for Payment posting and Submission (Rejections resubmit to the Submission TAT), in working hours.
  for (const k of ["posting", "submission"]) {
    if (!scope.includes(k) && !(k === "submission" && scope.includes("rejection"))) continue;
    // The form always sends it (24 to start); an older caller that sends none gets 24.
    const v = p.tat && p.tat[k] != null && p.tat[k] !== "" ? Math.round(num(p.tat[k], 0)) : HANDOFF_TAT_HOURS;
    if (v < 1 || v > 240) miss.push(`the ${SERVICE_NAME[k]} TAT in working hours (1 to 240)`); else cols[k + "_tat_hours"] = v;
  }
  if (scope.includes("submission")) {
    // when the recheck opens: 48 working hours after submitting unless the client needs it sooner (never later than 48)
    const sh = p.tat && p.tat.subcheck != null && p.tat.subcheck !== "" ? Math.round(num(p.tat.subcheck, 0)) : SUBCHECK_HOURS;
    if (sh < 1) miss.push("when the recheck opens, in working hours (1 to 48)"); else cols.subcheck_hours = Math.min(SUBCHECK_HOURS, sh);
    const sc = resp.subcheck || {};
    if (sc.mode === "biller") { cols.submission_check_mode = "biller"; cols.submission_check_person = null; }
    else if (sc.mode === "person" && sc.lead) { cols.submission_check_mode = "person"; cols.submission_check_person = str(sc.lead, 60); ids.push(cols.submission_check_person); }
    else miss.push("who rechecks submitted claims after 48 hours");
  } else { cols.submission_check_mode = ""; cols.submission_check_person = null; cols.subcheck_hours = null; }
  const want = ids.filter(Boolean);
  if (want.length) { const ok = new Set((await all(env, `SELECT id FROM users WHERE active = 1 AND id IN (${want.map(() => "?").join(",")})`, ...want)).map((r) => r.id)); if (want.some((i) => !ok.has(i))) miss.push("only people who are active"); }
  if (miss.length) throw bad(`To ${isNew ? "create" : "save"} this client, add ${andList(miss)}.`);
  return { scope, targets, cols };
}
/* "Payment posting: Snail Post (backup Paula PostLead)" for the change history. */
async function describeProfile(env, c) {
  const names = await namesOf(env, RESP_PEOPLE.map(([, l]) => c[l]));
  const scope = jsonList(c.scope_json), targets = jsonObj(c.targets_json), out = [];
  for (const [s, label] of SERVICES) {
    const [m, l, b] = RESP_COLS[s];
    const who = c[m] === "person" && c[l] ? names.get(c[l]) + (c[b] ? " (backup " + names.get(c[b]) + ")" : "") : c[m] === "client" ? "client does it" : c[m] === "biller" ? "biller does it" : "not set";
    out.push(`${label}: ${scope.includes(s) ? "in scope" + (targets[s] ? ", target " + targets[s] + " a day" : "") + ", " : scope.length ? "not in scope, " : ""}${who}`);
  }
  out.push("Submission follow-up: " + (c.submission_check_mode === "person" ? names.get(c.submission_check_person) || "someone" : c.submission_check_mode === "biller" ? "the biller who sent it" : "not set")
    + (scope.includes("submission") ? ", recheck " + subcheckHours(c) + " working hours after submitting" : ""));
  return out;
}
const diffLines = (before, after) => after.map((x, i) => (x !== before[i] ? x + (before[i] ? "  (was: " + before[i].replace(/^[^:]+: /, "") + ")" : "") : null)).filter(Boolean);
/* Tell people when they are made responsible for a client (or taken off it): a line in their bell for two
   weeks, and an email when one is set up. */
const RESP_LABEL = { ar_lead: "AR follow-up person (accountable)", ar_backup: "AR follow-up backup", posting_lead: "Payment posting person", posting_backup: "Payment posting backup",
  submission_lead: "Submission person", submission_backup: "Submission backup", submission_check_person: "Submission follow-up person (the recheck after submitting)", rejection_lead: "Rejections person", rejection_backup: "Rejections backup" };
async function noticeResponsibility(env, actor, client, before, after) {
  const on = (row, m, l) => (row && row[m] === "person" && row[l]) || null;
  const added = [], removed = [];
  for (const [m, l] of RESP_PEOPLE) {
    const was = on(before, m, l), now = on(after, m, l);
    if (now && now !== was) added.push([now, l]);
    if (was && was !== now) removed.push([was, l]);
  }
  const bTeam = parseTeam(before && before.team_json), aTeam = after && after.team_json !== undefined ? parseTeam(after.team_json) : bTeam;
  aTeam.filter((x) => !bTeam.includes(x)).forEach((x) => added.push([x, "team"]));
  bTeam.filter((x) => !aTeam.includes(x)).forEach((x) => removed.push([x, "team"]));
  const who = (actor && actor.name) || "Someone", now = Date.now();
  const people = new Map((await all(env, `SELECT id, name, email, email_missing, active FROM users WHERE id IN (${[...added, ...removed].map(() => "?").join(",") || "NULL"})`, ...[...added, ...removed].map(([u]) => u))).map((u) => [u.id, u]));
  for (const [uid, col] of added) {
    if (actor && uid === actor.id) continue;
    const role = col === "team" ? "one of the billers" : "the " + RESP_LABEL[col];
    const text = `${who} made you ${role} for ${client.name}. Its profile is in your clients and its claims are open to you.`;
    await run(env, "INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)", uuid(), uid, now, text, "clients", client.id);
    const u = people.get(uid);
    if (env.EMAIL_PROVIDER && u && u.active && u.email && !u.email_missing) {
      const link = env.APP_URL ? env.APP_URL.replace(/\/+$/, "") + "/#/clients" : "";
      try { await sendEmail(env, { to: u.email, subject: `You are now ${role} for ${client.name}`, text: text + (link ? "\n\nOpen Brahmastra: " + link : ""),
        html: `<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#0F1B24;max-width:600px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0E8C74;font-weight:700">Brahmastra</div><p>${htmlEsc(text)}</p>${link ? `<p><a href="${htmlEsc(link)}" style="background:#14B8A6;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">Open my clients</a></p>` : ""}</div>` }); }
      catch (e) { console.log("Responsibility email: " + (e && e.message)); }
    }
  }
  for (const [uid, col] of removed) {
    if (actor && uid === actor.id) continue;
    await run(env, "INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)", uuid(), uid, now,
      `${who} took you off ${client.name} (${col === "team" ? "billers" : RESP_LABEL[col]}).`, "clients", client.id);
  }
}
/* ---- who sees which projects ----
   Admins and the VP (access_all) see every client, and so does an account added by hand that has no projects
   (the bootstrap account). Everyone else, billers included, sees the clients their projects are matched to:
   their own projects (team leads and SMEs too), managers also every project of the people under them, plus
   clients shared with them person-to-person. user.scope is null (everything) or the list of client ids. */
async function scopeOf(env, user) {
  if (user.is_admin || user.access_all) { user.resp_clients = new Set(); return null; }
  // Anyone set on a client profile as responsible (AR, posting, submission, follow-up, rejections), or on its team,
  // gets that client: the claims and the profile. Supervisors can change it; billers only see it.
  const cls = await all(env, `SELECT id, roster_names_json, team_json, ar_mode, ar_lead, ar_backup, posting_mode, posting_lead, posting_backup, submission_mode, submission_lead, submission_backup,
    submission_check_mode, submission_check_person, rejection_mode, rejection_lead, rejection_backup FROM clients`);
  const resp = cls.filter((c) => RESP_PEOPLE.some(([m, l]) => c[l] === user.id && c[m] === "person")).map((c) => c.id);
  const onTeam = cls.filter((c) => parseTeam(c.team_json).includes(user.id)).map((c) => c.id);
  user.resp_clients = new Set(resp);
  const mine = (user.scope_projects && user.scope_projects.length ? user.scope_projects
    : (user.projects || []).map((p) => (p && p.name != null ? p.name : p))).filter(Boolean);
  // A team lead added by hand with no projects sees everything. A biller added by hand with no projects sees the clients they
  // are set on or have claims of, not every client.
  if (!mine.length && user.source !== "roster" && user.role !== "user") return null;
  const handBiller = !mine.length && user.source !== "roster"
    ? (await all(env, "SELECT DISTINCT client_id FROM claims WHERE assigned_to = ? OR last_worked_by = ?", user.id, user.id)).map((r) => r.client_id) : [];
  const names = new Set(mine.map(projKey));
  const own = [...new Set([...handBiller,...cls.filter((c) => jsonList(c.roster_names_json).some((n) => names.has(projKey(n)))).map((c) => c.id), ...resp, ...onTeam])];
  // Clients shared person-to-person (Clients & locations, Shared with): they add to what this person sees; a "view" share cannot be changed.
  const grants = await all(env, "SELECT client_id, level FROM client_access WHERE user_id = ?", user.id);
  user.scope_view_only = new Set(grants.filter((g) => g.level !== "edit" && !own.includes(g.client_id)).map((g) => g.client_id));
  return [...new Set([...own, ...grants.map((g) => g.client_id)])];
}
/* Who may be given a client's claims: an active biller (not a team lead) whose projects include the client. A biller added by
   hand with no projects can be given any client's claims (that is how they come to see it). */
async function billerFor(env, userId, clientId) {
  const row = userId ? await one(env, "SELECT * FROM users WHERE id = ? AND active = 1", str(userId, 60)) : null;
  if (!row) return null;
  const u = publicUser(row);
  if (u.role !== "user" || u.is_admin || userDesk(u)) return null;
  const projects = (u.projects || []).map((p) => (p && p.name != null ? p.name : p)).filter(Boolean);
  if (!projects.length && !(u.scope_projects || []).length && u.source !== "roster") return u;
  const sc = await scopeOf(env, u);
  return sc == null || sc.includes(clientId) ? u : null;
}
/* Who a hand-off may be given to (the same idea as billerFor, for the desks): the active people of its desk (Payment posting for a
   posting hand-off; Submission for a submission, a rejection or a recheck) who can work the claim's client: it is in their
   projects, they are set on it, or it is shared with them to edit (a view-only share is not enough). deskTeam reads everyone on
   a desk once; onDeskFor answers for one hand-off. The Posting & submission tab offers exactly this list. */
async function deskTeam(env) {
  const out = [];
  for (const row of await all(env, "SELECT * FROM users WHERE active = 1 ORDER BY name")) {
    const u = publicUser(row), desk = userDesk(u);
    if (!desk || u.is_admin) continue;
    const scope = await scopeOf(env, u);
    out.push({ id: u.id, name: u.name, desk, scope, view: u.scope_view_only || new Set() });
  }
  return out;
}
const onDeskFor = (m, dept, clientId) => (m.desk === "both" || m.desk === (dept === "posting" ? "posting" : "submission")) && (m.scope == null || (m.scope.includes(clientId) && !m.view.has(clientId)));
const projKey = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const inScope = (user, clientId) => !user.scope || user.scope.includes(clientId);
const canEditClient = (user, clientId) => inScope(user, clientId) && !(user.scope_view_only && user.scope_view_only.has(clientId));
const leadFor = (user, clientId) => user.role === "supervisor" && canEditClient(user, clientId);
const viewOnly = () => denied("This client is shared with you view-only: you can look, not change it.");
const editableOr = (user, clientId) => { if (!inScope(user, clientId)) throw outOfScope(); if (!canEditClient(user, clientId)) throw viewOnly(); };
// The clients someone may change: their scope minus the view-only shares (null means everything).
const editScope = (user) => (!user || !user.scope ? null : (user.scope_view_only && user.scope_view_only.size ? user.scope.filter((id) => !user.scope_view_only.has(id)) : user.scope));
const editScopeSql = (user, col) => { const sc = editScope(user); return sc == null ? "" : ` AND ${col} IN (${sc.length ? sc.map(() => "?").join(",") : "NULL"})`; };
const editScopeArgs = (user) => editScope(user) || [];
const isSME = (u) => u && u.source === "roster" && /\bsme\b|subject matter/i.test(String(u.designation || ""));
// " AND col IN (...)" for a scoped team lead, "" otherwise; scopeArgs gives the matching parameters.
const scopeSql = (user, col) => (!user || !user.scope ? "" : ` AND ${col} IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`);
const scopeArgs = (user) => (user && user.scope) || [];
const outOfScope = () => denied("That project is not one of yours.");
/* A client of a team lead's own span, for matching a roster project to it: one they may change and are responsible for (set on
   its profile), or that one of their own projects is already matched to, or that they added themselves. A client someone shared
   with them is not, and neither is one that only has no roster project yet. */
const ownClient = (user, c) => !user.scope || (canEditClient(user, c.id) && ((!!user.resp_clients && user.resp_clients.has(c.id)) || c.created_by === user.id
  || jsonList(c.roster_names_json).some((n) => (user.scope_projects || []).some((p) => projKey(p) === projKey(n)))));
const notYours = () => denied("That person is not on your team: they are not on your own projects and do not report up to you. Ask their team lead or the admin.");
/* Team status rules: Training and OJT are due in production 6 weeks from their start (4 weeks training + 2 OJT);
   attainment under 90% counts as below the production mark. */
const RAMP_WEEKS = 6, PERF_MARK = 90;
/* Suggestions on Team status: plain pointers, urgent first. Each says what we see and what to do. */
function teamSuggestions(rows) {
  const today = [], week = [], good = [];
  const fmtD = (d) => { try { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return d; } };
  const item = (r, seen, todo) => ({ user_id: r.id, who: r.name, lead: r.lead_name || "", seen, do: todo });
  const flagged = new Set();
  const nDays = (n) => n + (n === 1 ? " day" : " days");
  const hm = (m) => { m = Math.round(m || 0); const h = Math.floor(m / 60), mm = m % 60; return h ? h + " h" + (mm ? " " + String(mm).padStart(2, "0") + " m" : "") : mm + " m"; };
  const floorSeen = (r) => `On the floor ${hm(r.on_floor_done_min)} of ${hm(r.floor_needed_done_min)} needed up to yesterday (short ${hm(r.floor_short_min)})`;
  // claims worked and team task items done both count toward the attainment
  const what = (claims, items) => (items ? `${claims} claims + ${items} task items` : "claims");
  const attainSeen = (r) => r.attain_basis === "done"
    ? `Attainment ${r.attain}% (${r.count_done != null ? r.count_done : r.worked_done} of ${Math.round(r.target_done)}${r.task_items_done ? "" : " claims"} up to yesterday${r.task_items_done ? ": " + what(r.worked_done, r.task_items_done) : ""})`
    : `Attainment ${r.attain}% today (${r.count_today != null ? r.count_today : r.worked_today} of ${Math.round(r.target_today)}${r.task_items_today ? ": " + what(r.worked_today, r.task_items_today) : " claims"})`;
  for (const r of rows) {
    const away = r.out_today === "out";
    if (r.esc_n) {
      const xs = r.escalations, open = xs.filter((e) => e.status === "Open").length;
      const split = [r.esc_ext ? r.esc_ext + " external" : "", r.esc_int ? r.esc_int + " internal" : ""].filter(Boolean).join(", ");
      today.push(item(r, `${xs.length} ${xs.length === 1 ? "escalation" : "escalations"} as our error (${split}): ` + xs.slice(0, 2).map((e) => `SR${e.sr} at ${e.client_name} (${e.kind}, ${e.dept}${e.dow ? ", DOW " + fmtD(e.dow) : ""})`).join("; ") + (xs.length > 2 ? "…" : ""),
        away ? "Out today: when they are back, go through it with them: the root cause and what to check next time." : `Go through ${xs.length === 1 ? "it" : "them"} with them today: the root cause and what to check next time.` + (open ? ` Close ${open === 1 ? "it" : "them"} in the Escalation tracker with the corrective and preventive action.` : "")));
      flagged.add(r.id);
    }
    if (r.ramp.flag === "over") { today.push(r.ramp.extended
      ? item(r, `${r.status}, the date agreed for production was ${fmtD(r.ramp.due)} (${nDays(-r.ramp.days)} ago)`, "If they have moved to production, update Purview Shastra; if not, agree a new date on their row.")
      : item(r, `${r.status}${r.ramp.start ? " since " + fmtD(r.ramp.start) : ""}, was due in production ${fmtD(r.ramp.due)} (${nDays(-r.ramp.days)} ago)`, "Decide today: move to production or extend, and note the new date on their row.")); flagged.add(r.id); }
    if (r.left_high >= 3) { today.push(item(r, `${r.left} claims left over, ${r.left_high} of them high priority` + (away ? "; out today" : ""), away ? `Rebalance the ${r.left_high} high priority claims to someone in today (Live status).` : `Have them work the ${r.left_high} high priority claims first, or rebalance them.`)); flagged.add(r.id); }
    if (r.status === "Production" && r.attain != null && r.attain_basis === "done" && r.target_done >= r.capacity && r.attain < 60) { today.push(item(r, attainSeen(r), away ? "Out today: sit with them when they are back and find out what is slowing them down." : "Sit with them today and find out what is slowing them down.")); flagged.add(r.id); }
    if (r.floor === "short" && r.on_floor_done_min < r.floor_needed_done_min * 0.75) { today.push(item(r, floorSeen(r), away ? "Out today: when they are back, go through their punch-ins and breaks in Purview Shastra with them." : "Talk to them today about time on the floor: late punch-ins, long breaks, early punch-outs.")); flagged.add(r.id); }
  }
  for (const r of rows) {
    if (r.status === "Production" && r.attain != null && r.attain_basis === "done" && r.target_done >= r.capacity && r.attain >= 60 && r.attain < PERF_MARK) { week.push(item(r, attainSeen(r), "Check their claim mix and notes; agree a daily number for next week.")); flagged.add(r.id); }
    if (r.ramp.flag === "soon") { week.push(item(r, `${r.status}, due in production ${fmtD(r.ramp.due)} (${r.ramp.days === 0 ? "today" : nDays(r.ramp.days)})${r.ramp.extended ? ", the date agreed" : ""}`, `Plan the move: about ${Math.round(r.capacity * 0.85)} claims a day by ${fmtD(r.ramp.due)}; check in before then.`)); flagged.add(r.id); }
    if (r.floor === "short" && r.on_floor_done_min >= r.floor_needed_done_min * 0.75) { week.push(item(r, floorSeen(r), "Remind them of the 8-hour rule and check their punch-ins and breaks in Purview Shastra.")); flagged.add(r.id); }
    if (r.idle_done_min != null && r.on_floor_done_min > 0 && r.idle_done_min >= 60 && r.idle_done_min >= r.on_floor_done_min * 0.1) { week.push(item(r, `Idle ${hm(r.idle_done_min)} of ${hm(r.on_floor_done_min)} on the floor up to yesterday (Shastra Guard)`, "Ask what keeps them idle: an empty desk, system trouble, or waiting on someone.")); flagged.add(r.id); }
    if ((r.days_unplanned || 0) >= 2) { week.push(item(r, `Out ${r.days_unplanned} days in these dates (absent, sick or marked out)`, "A short check-in on attendance.")); flagged.add(r.id); }
    if (r.left_high > 0 && r.left_high < 3) { week.push(item(r, `${r.left} claims left over, ${r.left_high} high priority`, "Clear the high priority ones first tomorrow.")); flagged.add(r.id); }
  }
  for (const r of rows) {
    if (flagged.has(r.id) || r.status !== "Production" || r.attain == null || r.attain < 100 || r.floor === "short") continue;
    const helpee = rows.find((x) => x.lead_id && x.lead_id === r.lead_id && x.id !== r.id && x.status === "Production" && x.attain != null && x.attain < PERF_MARK);
    good.push(item(r, attainSeen(r) + (r.floor === "met" ? ", floor time met" : "") + ", nothing high priority left over", "Thank them in the huddle" + (helpee ? `; they could help ${helpee.name}.` : ".")));
  }
  return { today, week, good };
}
/* Managers and above (assistant managers, managers, the VP, admins) can narrow the Dashboard to one team lead. */
const isManagerUp = (u) => !!u && (u.is_admin || u.access_all || u.roster_kind === "manager" || (u.role === "supervisor" && !u.scope));
/* The clients one team lead covers (their own span), for a manager who picked that team lead; null means no narrowing. */
async function leadClientIds(env, user, leadId) {
  if (!leadId) return null;
  if (!isManagerUp(user)) throw denied("Only managers and above can pick a team lead.");
  const id = str(leadId, 60);
  if (!(await visibleUsers(env, user)).some((u) => u.id === id)) throw denied("That team lead is not in your span.");
  const row = await one(env, "SELECT * FROM users WHERE id = ?", id);
  if (!row) throw bad("Unknown team lead.");
  const lead = publicUser(row);
  const sc = await scopeOf(env, lead);
  return sc == null ? null : sc.filter((c) => !user.scope || user.scope.includes(c));
}
/* Who the Dashboard's team part shows: the billers this person sees, grouped by whom they report to; narrowed by a
   team lead (managers and above), and by a client or location (its people and anyone working its claims). */
async function dashTeamFilter(env, user, payload) {
  const all0 = await visibleUsers(env, user);
  const byId = new Map(all0.map((u) => [u.id, u]));
  // AR billers: people whose work is only Payment posting or Submission have their own desks and are left out here.
  const billers = all0.filter((u) => u.role === "user" && u.active && (!String(u.department || "").trim() || isAR(u)));
  const leadOf = (u) => { const l = u.reports_to && byId.get(u.reports_to); return l ? { id: l.id, name: l.name } : { id: "", name: "" }; };
  const canPickLead = isManagerUp(user);
  const counts = new Map();
  for (const u of billers) { const l = leadOf(u); if (l.id) counts.set(l.id, { id: l.id, name: l.name, n: ((counts.get(l.id) || {}).n || 0) + 1 }); }
  const leads = canPickLead ? [...counts.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
  let people = billers;
  const leadId = payload.lead_id ? str(payload.lead_id, 60) : "";
  if (leadId) { if (!canPickLead) throw denied("Only managers and above can pick a team lead."); people = people.filter((u) => u.reports_to === leadId); }
  let clientIds = null, locationId = "", teamIds = new Set();
  if (payload.client_id) {
    const cid = str(payload.client_id, 60);
    if (user.scope && !user.scope.includes(cid)) throw outOfScope();
    clientIds = [cid];
    const c = await one(env, "SELECT team_json FROM clients WHERE id = ?", cid);
    parseTeam(c && c.team_json).forEach((x) => teamIds.add(x));
    if (payload.location_id) {
      locationId = str(payload.location_id, 60);
      const l = await one(env, "SELECT team_json FROM locations WHERE id = ? AND client_id = ?", locationId, cid);
      const lt = parseTeam(l && l.team_json);
      if (lt.length) teamIds = new Set(lt);
    } else for (const l of await all(env, "SELECT team_json FROM locations WHERE client_id = ?", cid)) parseTeam(l.team_json).forEach((x) => teamIds.add(x));
    for (const g of await all(env, "SELECT user_id FROM client_access WHERE client_id = ?", cid)) teamIds.add(g.user_id);
  } else if (leadId) clientIds = await leadClientIds(env, user, leadId);
  // Who of them this person may also do something with (out today, the Team status note, rebalance): everyone, except the
  // people they see only through a view-only share.
  const act = user.scope && user.scope_view_only && user.scope_view_only.size ? new Set((await visibleUsers(env, user, "edit")).map((u) => u.id)) : null;
  return { people, leads, canPickLead, leadOf, clientIds, locationId, teamIds, narrow: !!payload.client_id, canAct: (id) => !act || act.has(id) };
}
/* Sign-in codes, password resets and edits for someone else: never for an admin unless you are one, and never for a team lead or
   manager above or beside you: only for people who report up to you, or billers and desk people in your own span (see
   visibleUsers "span": a client shared with you, or a place on a client's team, never makes a person yours). */
async function mayActAs(env, user, targetId) {
  if (user.is_admin) return true;
  if (targetId === user.id) return false;
  const t = await one(env, "SELECT id, role, reports_to FROM users WHERE id = ?", targetId);
  if (!t || t.role === "admin") return false;
  if (t.role !== "supervisor") return inSpan(env, user, t.id);
  const seen = new Set();
  for (let id = t.reports_to; id && !seen.has(id); ) { if (id === user.id) return true; seen.add(id); const u = await one(env, "SELECT reports_to FROM users WHERE id = ?", id); id = u ? u.reports_to : null; }
  return false;
}
/* The people a scoped team lead sees: themselves, everyone below them, everyone on their projects, and everyone on the teams of
   their clients or with a share of one (so crossover billers can be picked and allocated, and show on the dashboards).
   mode "edit": the teams and shares of the clients they may change only. A view-only share shows the client's people; it gives
     nothing to do with them (out today, the Team status note, rebalance, a team task).
   mode "span": their own span only: everyone below them and everyone on their own projects. Only these are theirs as people
     (sign-in codes, password resets, edits, switching off, coaching notes). Holding a share of a client, or putting someone on a
     client's team, never makes a person theirs. */
async function visibleUsers(env, user, mode) {
  const users = await all(env, "SELECT * FROM users ORDER BY role DESC, name, email");
  if (!user.scope) return users;
  const names = new Set(user.scope_projects.map(projKey));
  const below = new Set([user.id]);
  for (let grew = true; grew;) { grew = false; for (const u of users) if (u.reports_to && below.has(u.reports_to) && !below.has(u.id)) { below.add(u.id); grew = true; } }
  const own = (u) => below.has(u.id) || jsonList(u.projects_json).some((p) => names.has(projKey(p.name)));
  if (mode === "span") return users.filter(own);
  const sc = mode === "edit" ? editScope(user) : user.scope;
  const teams = new Set();
  for (const c of await all(env, "SELECT team_json FROM clients WHERE id IN (" + (sc.length ? sc.map(() => "?").join(",") : "NULL") + ")", ...sc)) parseTeam(c.team_json).forEach((id) => teams.add(id));
  // People a client was shared with count as on it, so crossover billers can be picked and allocated.
  if (sc.length) for (const g of await all(env, `SELECT user_id FROM client_access WHERE client_id IN (${sc.map(() => "?").join(",")})`, ...sc)) teams.add(g.user_id);
  return users.filter((u) => own(u) || teams.has(u.id));
}
const inSpan = async (env, user, id) => !user.scope || (await visibleUsers(env, user, "span")).some((u) => u.id === id);


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
    reports_to: g("reportsto", "manager", "supervisor"), shift: g("shift"), exit_date: rosterDate(g("exitdate")), doj: rosterDate(g("doj", "dateofjoining", "joiningdate")), email: mailClean(g("email", "emailid", "workemail")),
    city: ((v) => (/pune/i.test(v) ? "Pune" : /hyd/i.test(v) ? "Hyderabad" : v))(g("location", "worklocation", "city", "site", "baselocation")) };
}
const NOT_IN_BRAHMASTRA = /^(eligibility verification|ev|pcc|credentialing|reporting)$/i;
const rowDepts = (row) => [row.department, ...String(row.departments_also || "").split(/[;,]/)].map((d) => String(d || "").trim()).filter(Boolean);
const rowWorkDepts = (row) => rowDepts(row).filter((d) => /^(ar|posting|submission)$/i.test(d));
/* Position text as typed in Shastra: case, dots, dashes and extra spaces do not matter, and a "Sr." / "Senior" /
   "Assistant" / "Deputy" / "Associate" in front of a known role counts as that role ("Sr. Team Lead" is a team lead). */
function rosterPos(position) {
  const p = String(position || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
  if (ROSTER_KIND[p]) return p;
  const base = p.replace(/^((sr|senior|jr|junior|asst|assistant|associate|deputy|principal|acting)\s+)+/, "");
  if (ROSTER_KIND[base]) return base;
  if (/^(sr|senior)\s/.test(p) && ROSTER_KIND["senior " + base]) return "senior " + base;
  return p;
}
function rosterClassify(row, keepKind) {
  const pos = rosterPos(row.position);
  let kind = ROSTER_KIND[pos];
  // A known lead or manager whose position text changed to something not recognised keeps their access (with a warning).
  const unknownPos = !kind && !!row.position && !!keepKind;
  if (unknownPos) kind = keepKind;
  const projects = rosterProjects(row.project, row.also_projects);
  let reason = "";
  if (!row.name) reason = "no name";
  else if (/^administration$/i.test(row.func) || /^(hr|it)$/i.test(row.department)) reason = (row.department || row.func) + " (no access)";
  else if (!kind) reason = (row.position || "no position") + " (no access)";
  // Agents and team leads need a project; managers see the projects of the people below them.
  else if ((kind === "agent" || kind === "lead") && !projects.length) reason = "no project";
  // Eligibility Verification, PCC, Credentialing and Reporting are not worked in Brahmastra: someone only there
  // (no AR, Posting or Submission in any of their departments) gets no access.
  else if (kind !== "all" && !rowWorkDepts(row).length && rowDepts(row).some((d) => NOT_IN_BRAHMASTRA.test(d))) reason = rowDepts(row).filter((d) => NOT_IN_BRAHMASTRA.test(d)).join(", ") + " only (not in Brahmastra)";
  return { kind, projects, reason, designation: ROSTER_DESIGNATION[pos] || row.position, unknownPos: unknownPos && !reason };
}
/* Team leads and SMEs see their own projects; managers also every project of the people below them. */
async function recomputeScopes(env) {
  const users = await all(env, "SELECT id, reports_to, roster_kind, projects_json, scope_projects_json, source, active FROM users");
  const kids = new Map(); for (const u of users) if (u.reports_to) { if (!kids.has(u.reports_to)) kids.set(u.reports_to, []); kids.get(u.reports_to).push(u); }
  const stmts = [];
  for (const u of users) {
    // People added by hand are scoped by their own projects (none = everything); only roster managers add their span.
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
  await rerouteHandoffs(env, userId);
}
const placeholderEmail = (row) => (row.emp_id || row.name).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") + "@no-email.invalid";

/* ---- payment posting & submission hand-offs ----
   A biller's SAAG action sends the claim to the department that does that work for the client
   (set on the client profile): Need to Post / Posting Correction -> Payment Posting; resubmission,
   paper claim and correction actions -> Submission. TAT: 24 working hours, Saturday and Sunday skipped (IST). */
const HANDOFF_TAT_HOURS = 24;
/* The client's TAT for a department, in working hours: Payment posting, or Submission (also for Rejections and the recheck). */
const tatHours = (cl, dept) => { const v = Number(cl && cl[(dept === "posting" ? "posting" : "submission") + "_tat_hours"]); return v > 0 ? v : HANDOFF_TAT_HOURS; };
const DEPT_LABEL = { posting: "Payment Posting", submission: "Submission", subcheck: "Submission follow-up", rejection: "Rejections" };
/* Who gets a new hand-off for a department of a client: the lead set on the profile, or the backup when the lead is not active.
   null when the department is not done by a person, or nobody set is active. */
async function deskPeople(env, cl, dept) {
  if (!cl || cl[dept + "_mode"] !== "person") return null;
  const L = cl[dept + "_lead"] || null, B = cl[dept + "_backup"] || null;
  const ids = [L, B].filter(Boolean);
  if (!ids.length) return null;
  const act = new Set((await all(env, `SELECT id FROM users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((r) => r.id));
  const lead = act.has(L) ? L : act.has(B) ? B : null;
  if (!lead) return null;
  return { lead, backup: B && B !== lead && act.has(B) ? B : null };
}
/* The desk an entry's SAAG action sends a claim to: Need to Post / Posting Correction to Payment posting, a resubmission or a
   paper claim to Submission (a rejected claim to the client's Rejections person first, when one is set), with the client's
   profile and the person set there (null when nobody active is set). dept is "" for an action that goes to no desk. */
async function entryDesk(env, clientId, saag) {
  let dept = handoffDeptOf(saag.action);
  if (!dept) return { dept: "", cl: null, people: null };
  const cl = await one(env, "SELECT * FROM clients WHERE id = ?", clientId);
  if (dept === "submission" && /reject/i.test(saag.status) && (await deskPeople(env, cl, "rejection"))) dept = "rejection";
  return { dept, cl, people: cl && cl[dept + "_mode"] === "person" ? await deskPeople(env, cl, dept) : null };
}
/* Send claims to the desk their entry names (a saved entry, or an entry edited into such an action): a hand-off to the person
   set on the client, and the claim is In process for AR (off the biller's list, no follow-up) until the desk is done; or a line
   in the history that nobody does it for this client. A claim already open with that desk keeps the hand-off it has.
   billerId: the AR biller of the claim (whose entry sent it). */
async function sendToDesk(env, user, clientId, saag, targets, now, billerId) {
  const { dept, cl, people } = await entryDesk(env, clientId, saag);
  if (!dept) return null;
  const mode = cl ? cl[dept + "_mode"] : "";
  const lead = people ? people.lead : null;
  const hs = [];
  for (const t of targets) {
    if (mode === "person" && lead) {
      const open = await one(env, "SELECT id FROM handoffs WHERE claim_id = ? AND dept = ? AND status IN ('pending','assigned','client')", t.id, dept);
      if (open) continue;
      const due = addWorkingHours(now, tatHours(cl, dept));
      hs.push(env.DB.prepare(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, saag_action, due_at, lead_id, backup_id, biller_id) VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,?)`)
        .bind(uuid(), t.id, clientId, dept, now, user.id, user.name, saag.action, due, lead, people.backup, billerId || user.id));
      // In process for AR while the department works it: off the biller's list, no follow-up, until it is done or sent back.
      hs.push(env.DB.prepare("UPDATE claims SET handoff_status = ?, state = ?, state_reason = ?, follow_up_on = '' WHERE id = ?").bind("with_" + dept, IN_PROCESS, "With " + DEPT_LABEL[dept], t.id));
      hs.push(claimEvent(env, t.id, user, "handoff_sent", DEPT_LABEL[dept], { dept, due_at: due }));
    } else hs.push(claimEvent(env, t.id, user, "handoff_none", DEPT_LABEL[dept], { dept, mode: mode === "person" ? "unset" : mode || "unset" }));
  }
  if (hs.length) await batchAll(env, hs, 40);
  const leadName = lead ? (await one(env, "SELECT name FROM users WHERE id = ?", lead) || {}).name : "";
  return { dept, label: DEPT_LABEL[dept], mode: mode === "person" && !lead ? "unset" : mode || "unset", to: leadName || "" };
}
/* Open hand-offs of someone who is switched off: they go to the backup, or to whoever the client's profile now names. */
async function rerouteHandoffs(env, userId) {
  const open = await all(env, "SELECT h.id, h.dept, h.lead_id, h.backup_id, h.assigned_to, h.client_id FROM handoffs h WHERE h.status IN ('pending','assigned','client') AND (h.lead_id = ? OR h.backup_id = ? OR h.assigned_to = ?)", userId, userId, userId);
  if (!open.length) return 0;
  const cls = new Map();
  const stmts = [];
  for (const h of open) {
    if (!cls.has(h.client_id)) cls.set(h.client_id, await one(env, "SELECT * FROM clients WHERE id = ?", h.client_id));
    const cl = cls.get(h.client_id);
    const desk = h.dept === "subcheck" ? null : await deskPeople(env, cl, h.dept);
    const backupOk = h.backup_id && h.backup_id !== userId ? await one(env, "SELECT id FROM users WHERE id = ? AND active = 1", h.backup_id) : null;
    let lead = h.lead_id, backup = h.backup_id === userId ? null : h.backup_id;
    if (h.lead_id === userId) {
      lead = backupOk ? h.backup_id : desk && desk.lead !== userId ? desk.lead : null;
      backup = desk && desk.backup && desk.backup !== lead ? desk.backup : null;
    }
    if (h.dept === "subcheck" && h.lead_id === userId && !lead) {
      // The recheck: the client's follow-up person when active, otherwise the AR biller of the claim.
      const p = cl && cl.submission_check_mode === "person" && cl.submission_check_person && cl.submission_check_person !== userId ? await one(env, "SELECT id FROM users WHERE id = ? AND active = 1", cl.submission_check_person) : null;
      lead = p ? p.id : null;
    }
    if (!lead) continue; // nobody active to take it: it stays for the team lead to see on the desk dashboard
    const assigned = h.assigned_to === userId ? (h.dept === "subcheck" ? lead : null) : h.assigned_to;
    stmts.push(env.DB.prepare("UPDATE handoffs SET lead_id = ?, backup_id = ?, assigned_to = ?, status = CASE WHEN status = 'assigned' AND ? IS NULL THEN 'pending' ELSE status END WHERE id = ?").bind(lead, backup, assigned, assigned, h.id));
  }
  if (stmts.length) await batchAll(env, stmts, 40);
  return stmts.length;
}
// After a claim is submitted, the follow-up check (accepted or rejected?) opens this many working hours later: 48, or sooner
// when the client needs it (a supervisor sets it on the client profile). Never later than 48: anything more is 48.
const SUBCHECK_HOURS = 48;
const subcheckHours = (cl) => { const v = Math.round(Number(cl && cl.subcheck_hours)); return v >= 1 && v <= SUBCHECK_HOURS ? v : SUBCHECK_HOURS; };
// A claim waiting on the client comes back to the open list as "Chase the client" after 3 working days.
const CHASE_HOURS = 72;
// Hand-offs with this many hours or less left are flagged at the top and to the team lead.
const DUE_SOON_HOURS = 4;
// Returned to AR this many times: escalated to the AR team lead and shown to the department's team lead.
const BOUNCE_LIMIT = 3;
// What was wrong with a rejected claim, for the rejection reports.
const REJECT_CODES = ["Subscriber / member ID invalid", "Patient name or DOB mismatch", "Payer ID or address invalid", "Rendering / billing NPI invalid or missing", "Taxonomy missing",
  "Diagnosis code invalid", "CPT or modifier invalid", "Place of service invalid", "Authorization / referral missing", "Duplicate claim", "Timely filing", "Coordination of benefits", "Other"];
const CLIENT_SENT_HOW = ["Email", "Client portal", "Call", "Fax", "Other"];
// While a claim is with Payment Posting, Submission or Rejections it is "In process" for AR (not on a biller's list).
const IN_PROCESS = "in_process";
// The claim status prefix for each department's outcomes (the follow-up check reports as Submission).
const HO_PREFIX = { posting: "posting", submission: "submission", subcheck: "submission", rejection: "rejection" };
const BACK_REASONS = ["Wrong department", "Not ready to post / submit", "Missing or wrong information from AR", "Duplicate request", "Other"];
const CLIENT_REASONS = { posting: ["Need EOB / ERA from the client", "Need payment / deposit details", "Need patient or account details", "Other"],
  submission: ["Need corrected demographics / insurance", "Need signature or documents", "Need authorization / referral", "Need coding clarification", "Other"] };
const HANDOFF_ROUTES = [[/^Need to Post\/Posting Correction$/i, "posting"], [/^(Need to Resubmit|Need to Submit Paper Claim|Correction, Resubmission & Reprocessing)$/i, "submission"]];
/* The scope of work on a client profile, and the responsibility columns behind each. Submission follow-up (the 48-hour
   recheck) belongs to Submission. */
const SERVICES = [["ar", "AR follow-up"], ["posting", "Payment posting"], ["submission", "Submission"], ["rejection", "Rejections"]];
const SERVICE_NAME = Object.fromEntries([...SERVICES, ["subcheck", "Submission follow-up"]]);
const RESP_PEOPLE = [["ar_mode", "ar_lead"], ["ar_mode", "ar_backup"], ["posting_mode", "posting_lead"], ["posting_mode", "posting_backup"], ["submission_mode", "submission_lead"], ["submission_mode", "submission_backup"],
  ["submission_check_mode", "submission_check_person"], ["rejection_mode", "rejection_lead"], ["rejection_mode", "rejection_backup"]];
/* What a client profile still needs, in plain words (empty when complete). */
function profileGaps(c, locCount, activeIds) {
  const g = [], scope = jsonList(c.scope_json), targets = jsonObj(c.targets_json);
  if (!scope.length) g.push("scope of work");
  if (!locCount) g.push("a location");
  for (const s of scope) {
    if (!NO_TARGET.has(s) && !(Number(targets[s]) > 0)) g.push(SERVICE_NAME[s] + " target");
    const [m, l] = RESP_COLS[s];
    if (c[m] !== "person" || !c[l]) g.push(SERVICE_NAME[s] + " responsible person");
    else if (!activeIds.has(c[l])) g.push(SERVICE_NAME[s] + " responsible person (the one set is no longer active)");
    if (s === "submission" && !(c.submission_check_mode === "biller" || (c.submission_check_mode === "person" && activeIds.has(c.submission_check_person)))) g.push("Submission follow-up (who rechecks after 48 hours)");
  }
  // without a scope of work yet, still flag a department pointed at someone who has left
  if (!scope.length) for (const s of ["posting", "submission", "rejection"]) { const [m, l] = RESP_COLS[s]; if (c[m] === "person" && c[l] && !activeIds.has(c[l])) g.push(SERVICE_NAME[s] + " responsible person (the one set is no longer active)"); }
  return g;
}
const RESP_COLS = { ar: ["ar_mode", "ar_lead", "ar_backup"], posting: ["posting_mode", "posting_lead", "posting_backup"], submission: ["submission_mode", "submission_lead", "submission_backup"], subcheck: ["submission_check_mode", "submission_check_person", null],
  rejection: ["rejection_mode", "rejection_lead", "rejection_backup"] };
const handoffDeptOf = (action) => { for (const [re, d] of HANDOFF_ROUTES) if (re.test(String(action || "").trim())) return d; return ""; };
const REJECT_REASONS = REJECT_CODES;
const ASSIST_REASONS = { subcheck: ["Payer has no record yet", "Cannot reach the payer / portal", "Other"], posting: ["No EOB / ERA", "Amount mismatch", "Patient / account not found", "Payer not set up", "Duplicate payment", "Other"],
  submission: ["Missing claim data", "Clearinghouse rejection", "No payer ID / address", "Authorization missing", "Duplicate claim", "Other"] };
ASSIST_REASONS.rejection = ASSIST_REASONS.submission;
/* Every TAT counts working hours only: Monday to Friday, IST. Saturday, Sunday and the company holidays from Purview Shastra
   (its holidays table, through dev/shastra-holidays-feed.sql) are skipped. The holidays sit in the setting "holidays" and are
   read again at most every 10 minutes. */
let HOLIDAYS = new Set(), holidaysAt = 0;
async function loadHolidays(env, force = false) {
  if (!force && Date.now() - holidaysAt < 600000) return HOLIDAYS;
  holidaysAt = Date.now();
  try { const h = await getSetting(env, "holidays", null); HOLIDAYS = new Set(h && Array.isArray(h.rows) ? h.rows.map((r) => String(r && r.date || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []); } catch (e) { /* keep the last list */ }
  return HOLIDAYS;
}
// d: a Date shifted to IST (its UTC fields are the IST date)
const offDay = (d) => { const dow = d.getUTCDay(); return dow === 0 || dow === 6 || HOLIDAYS.has(d.toISOString().slice(0, 10)); };
const ATTN_TAT_HOURS = 48;  // Needs attention (flagged by billers, sent back by the desks, client requests): a team lead closes it within 48
const ESC_TAT_HOURS = 24;   // Escalation tracker: open past 24 working hours, the team lead gives the reason and expected date
/* The moment N working hours before ms: anything that started before it is past an N-hour TAT now. */
function subWorkingHours(ms, hours) {
  let t = ms, left = hours * 3600000;
  for (let guard = 0; left > 0 && guard < 2000; guard++) {
    const d = new Date(t - 1 + IST_MIN * 60000);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MIN * 60000;
    if (offDay(d)) { t = dayStart; continue; }
    const step = Math.min(left, t - dayStart);
    t -= step; left -= step;
  }
  return t;
}
/* Working hours (Monday to Friday, IST) between two moments. */
function workingHoursBetween(a, b) {
  if (!(b > a)) return 0;
  let t = a, ms = 0;
  for (let guard = 0; t < b && guard < 4000; guard++) {
    const d = new Date(t + IST_MIN * 60000);
    const dayEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MIN * 60000 + 86400000;
    const step = Math.min(b, dayEnd) - t;
    if (!offDay(d)) ms += step;
    t += step;
  }
  return ms / 3600000;
}
const escPast = (at, now = Date.now()) => !!at && addWorkingHours(at, ESC_TAT_HOURS) < now;
/* A claim's age in days by date of service (the file's age when the date is missing or not a real date): one ? for today. */
const AGE_SQL = (p = "") => `(CASE WHEN ${p}dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN COALESCE(julianday(?) - julianday(substr(${p}dos, 1, 10)), ${p}age_days) ELSE ${p}age_days END)`;
/* The age buckets (the names the page's BUCKETS use) by that age today, as the rows and the over-90 figures count it, not the bucket
   saved at upload: a claim's bucket moves on as it ages. A DOS in the future is 0-30. */
const AGE_BUCKETS = [["0\u201330", -99999, 30], ["31\u201360", 31, 60], ["61\u201390", 61, 90], ["91\u2013120", 91, 120], ["120+", 121, 99999]];
const AGE_BUCKET_SQL = (age) => `(CASE WHEN ${age} IS NULL THEN bucket ${AGE_BUCKETS.slice(0, -1).map(([k, , hi]) => `WHEN ${age} <= ${hi} THEN '${k}'`).join(" ")} ELSE '120+' END)`;
// claims in the bucket picked, today: three ? (today, from, to). For a list whose conditions get a table prefix: "id IN (...)".
const IN_AGE_BUCKET = "id IN (SELECT id FROM claims WHERE " + AGE_SQL() + " BETWEEN ? AND ?)";
const ageBucketArgs = (name, today) => { const b = AGE_BUCKETS.find(([k]) => k === name); return b ? [today, b[1], b[2]] : null; };
/* Turning 90 soon: a claim crosses into "over 90" (the AR Aging KPI) when it is 91 days old. On a biller's list, claims 77 to 90 days
   old move up (more in their last week), so they are worked before they cross. Two ? for today. */
// A claim the team lead Lowered stays behind the others: it gets no turning-90 boost until the setting is changed back.
const TURN90_BOOST = (p = "") => `(CASE WHEN ${p}priority_set = 'low' THEN 0 WHEN ${AGE_SQL(p)} BETWEEN 84 AND 90 THEN 40 WHEN ${AGE_SQL(p)} BETWEEN 77 AND 83 THEN 20 ELSE 0 END)`;
function addWorkingHours(ms, hours) {
  let t = ms, left = hours * 3600000;
  for (let guard = 0; left > 0 && guard < 2000; guard++) {
    const d = new Date(t + IST_MIN * 60000);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MIN * 60000;
    if (offDay(d)) { t = dayStart + 86400000; continue; }
    const step = Math.min(left, dayStart + 86400000 - t);
    t += step; left -= step;
  }
  return t;
}
/* Where a Needs attention claim can go after review: the departments that have a person on this client. */
const reviewShape = (r) => ({ ...r, depts: ["posting", "submission", "rejection"].filter((d) => r[d + "_mode"] === "person").map((d) => ({ id: d, label: DEPT_LABEL[d] })) });
async function reviewPeople(env, user) {
  return (await visibleUsers(env, user)).filter((u) => u.active && u.role === "user" && !userDesk(u)).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}
/* The biller of a recheck: the one who sent the claim for (re)submission, or whose list it is on, or who last worked it. */
const isRecheckBiller = (user, h, c) => !!user && (h.biller_id === user.id || (!!c && (c.assigned_to === user.id || c.last_worked_by === user.id)));
/* Who may see and act on a claim through a hand-off: the department lead, the backup, and the person it is assigned to. */
async function handoffRole(env, user, claimId) {
  const rows = await all(env, "SELECT lead_id, backup_id, assigned_to FROM handoffs WHERE claim_id = ?", claimId);
  if (rows.some((h) => h.lead_id === user.id || h.backup_id === user.id)) return "lead";
  if (rows.some((h) => h.assigned_to === user.id)) return "member";
  return "";
}
async function canSeeClaim(env, user, c) {
  const dd = deskDepts(user);
  if (dd) {
    // Payment posting and Submission people, team leads too, see the claims handed to their desk, and every claim of a client they
    // are responsible for (README); never the rest of the client's claims, whatever their role
    if (user.resp_clients && user.resp_clients.has(c.client_id)) return true;
    if (await handoffRole(env, user, c.id)) return true;
    return leadFor(user, c.client_id) && !!(await one(env, `SELECT 1 AS x FROM handoffs WHERE claim_id = ? AND dept IN (${dd.map(() => "?").join(",")}) LIMIT 1`, c.id, ...dd));
  }
  if (leadFor(user, c.client_id) || c.assigned_to === user.id || c.last_worked_by === user.id) return true;
  if (user.resp_clients && user.resp_clients.has(c.client_id)) return true;
  return !!(await handoffRole(env, user, c.id));
}
/* A claim Posting closed (the payment posted, the claim closed): anyone signed in may open it to read, and nobody can edit
   its earlier notes. Adding a note or an entry stays with the people above. */
const postedClosed = (c) => !!c && c.state === "closed" && c.handoff_status === "posted";
const POSTED_CLOSED_SQL = "(c.state = 'closed' AND c.handoff_status = 'posted')";
async function canViewClaim(env, user, c) { return postedClosed(c) || (await canSeeClaim(env, user, c)); }

/* --------------------------------------------------------- the ops */
/* ---- how a claim is recognised across uploads ----
   alt_key: the claim number with everything but letters and digits removed, lower case, no leading
            zeros, no Excel ".0" tail. "CLM 0012345", "12345.0" and "clm-12345" all become "clm12345" / "12345".
   fp_key:  patient + date of service, for files that carry no claim number at all. A claim with no number
            is given a generated id "BR-xxxxxxxx" from that fingerprint, so the same patient/DOS maps to
            the same id in every later file. */
function altKeyOf(claimNo) {
  const raw = String(claimNo || "").trim().toLowerCase().replace(/\.0+$/, "");
  // One long run of digits is the claim number itself ("CLM 0012345", "clm-12345" and "12345" agree). With more than one run
  // (a year prefix "CLM-2024-00001", a line suffix "77777/1") every run counts, so CLM-2025-00001 and 77777/2 stay different claims.
  // Shorter ids keep their letters.
  const runs = raw.match(/\d+/g) || [];
  const nz = (x) => x.replace(/^0+(?=\d)/, "");
  const s = runs.length === 1 && runs[0].length >= 5 ? nz(runs[0])
    : runs.length > 1 && runs.some((x) => x.length >= 5) ? runs.map(nz).join("-")
    : nz(raw.replace(/[^a-z0-9]/g, ""));
  return /\d/.test(s) ? s.slice(0, 80) : "";
}
/* Claims keyed by the older rule (only the longest run of digits): give them the current key once. */
async function rekeyAlt(env) {
  if ((await getSetting(env, "alt_key_v", 1)) >= 2) return;
  let after = "";
  for (let round = 0; round < 1000; round++) {
    const rows = await all(env, "SELECT id, claim_no, alt_key FROM claims WHERE id > ? AND alt_key <> '' ORDER BY id LIMIT 500", after);
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    const ch = rows.filter((r) => altKeyOf(r.claim_no) !== r.alt_key);
    if (ch.length) await batchAll(env, ch.map((r) => env.DB.prepare("UPDATE claims SET alt_key = ? WHERE id = ?").bind(altKeyOf(r.claim_no), r.id)), 50);
    if (rows.length < 500) break;
  }
  await setSetting(env, "alt_key_v", 2);
}
const normText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/* ---- priority set by a team lead: applied on top of the automatic score, and kept through uploads and allocation.
   Keep PRIORITY_LEVELS in step with index.html. */
const PRIORITY_LEVELS = { top: { label: "Top: work first", add: 200, mul: 1 }, high: { label: "Raised", add: 60, mul: 1 }, low: { label: "Lowered", add: 0, mul: 0.3 } };
const applyLevel = (base, level) => { const l = PRIORITY_LEVELS[level]; return l ? Math.round(((Number(base) || 0) * l.mul + l.add) * 10) / 10 : Number(base) || 0; };
// SQL for "the automatic score ?, with this claim's team lead setting applied"; bind prioArgs(score) in its place.
const PRIO_SQL = "CASE priority_set WHEN 'top' THEN ROUND(? + 200, 1) WHEN 'high' THEN ROUND(? + 60, 1) WHEN 'low' THEN ROUND(? * 0.3, 1) ELSE ? END";
const prioArgs = (v) => [v, v, v, v];
const PRIO_REASON_SQL = "CASE WHEN priority_set <> '' THEN priority_set_label || ' · ' || ? ELSE ? END";
function fpKeyOf(patient, dos) { const p = normText(patient), d = isoDate(dos); return p && d ? p + "|" + d : ""; }
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
const generatedClaimNo = (fp) => "BR-" + fnv1a(fp).toUpperCase();
/* A BR-... number is made up by Brahmastra for a claim that came without one: it is no claim number. Such a claim is found again
   by patient + DOS (and the payer, when both sides have one), so a later file that carries its real number refreshes it instead
   of adding a second claim. Two different real claim numbers are always two claims. */
const isGeneratedNo = (r) => !!r && !!r.fp_key && r.claim_no === generatedClaimNo(r.fp_key);
const samePayer = (a, b) => { const x = normText(a), y = normText(b); return !x || !y || x === y; };
/* What one worked-file row said about a claim, kept with that upload. "Worked by" is read from the file's own column when it has one. */
function fileSnapshot(kind, vals, c, lastWorked, followUp) {
  const raw = c.raw && typeof c.raw === "object" ? c.raw : {};
  const pick = (re) => { const k = Object.keys(raw).find((h) => re.test(h)); return k ? str(raw[k], 120) : ""; };
  return { kind, status: vals.file_status, sub_status: vals.file_sub_status, action: vals.file_action, comments: str(vals.file_comments, 2000), balance: vals.balance,
    worked_on: lastWorked, follow_up: followUp, worked_by: pick(/^(worked\s*by|work(ed)?\s*user|biller|agent|user\s*name|employee)$/i), move_to: pick(/^move\s*to$/i) };
}
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

/* Payment posting and Submission people (their Shastra department), team leads included, work only on the claims
   handed to their department: no inventory, allocation or SAAG screens, and Claims shows only those claims. */
const DESK_DEPTS = { posting: ["posting"], submission: ["submission", "subcheck", "rejection"], both: ["posting", "submission", "subcheck", "rejection"] };
const DESK_NAME = { posting: "Payment posting", submission: "Submission", both: "Posting & submission" };
// From the Shastra department and the "also in" departments: anyone on AR keeps the AR view.
function userDesk(user) {
  if (!user) return null;
  const d = new Set(rowDepts({ department: user.department, departments_also: user.departments_also }).map((x) => x.toLowerCase()));
  if (d.has("ar")) return null;
  const p = d.has("posting"), s = d.has("submission");
  return p && s ? "both" : p ? "posting" : s ? "submission" : null;
}
const deskSql = (user, col) => { const d = userDesk(user); return d && !user.is_admin ? ` AND ${col} IN (SELECT claim_id FROM handoffs WHERE dept IN (${DESK_DEPTS[d].map((x) => "'" + x + "'").join(",")}))` : ""; };
// A Payment posting / Submission person's desk (null for AR people and the admin), and the departments it covers.
const deskOf = (user) => (user && !user.is_admin ? userDesk(user) : null);
const deskDepts = (user) => { const d = deskOf(user); return d ? DESK_DEPTS[d] : null; };
/* What is AR's and never a desk person's (team leads too), whatever the call: inventory, allocation and the claims pool, excluding or
   reprioritising claims and their log, Needs attention, My day, Live status and the day's team, the AR entries, Team allocations,
   repeat denials, the Client 360 report and the AR Inventory report. */
const DESK_NOT = /^(inventory\.|alloc\.|attention\.|queue\.|creport\.|denials\.|claims\.(eligible|setState|setPriority|priorityLog)$|reports\.(arInventory|saveArInventory|work|desk)$|supervisor\.allocations$|team\.(huddle|today|saveToday)$)/;
const unreadable = (v, depth = 0) => v !== null && typeof v === "object" && depth < 10
  && (Object.prototype.hasOwnProperty.call(v, "toString") || Object.prototype.hasOwnProperty.call(v, "valueOf") || Object.values(v).some((x) => unreadable(x, depth + 1)));
const PUBLIC_OPS = new Set(["auth.login", "auth.sendOtp", "auth.verifyOtp", "auth.signup", "meta.info", "auth.lookup", "auth.setupCode", "auth.completeSetup", "auth.loginById", "auth.adminCode", "auth.adminVerify", "auth.firstPassword"]);
/* Read-only claim lists a biller may open for the clients they are responsible for (posting, submission...). */
const DESK_READ_OPS = /^claims\.(list|stats)$/;
const respOnly = (user) => { if (user.role === "supervisor") return null; const ids = [...(user.resp_clients || [])]; if (!ids.length) throw denied("Supervisor access is needed for this."); return ids; };
const SUPERVISOR_OPS = /^(tat\.|denials\.|escalations\.|coach\.|digest\.|portfolio\.|audit\.|client\.|monthend\.|users\.|clients\.save|clients\.saveTeam|clients\.delete|clients\.access|raci\.|locations\.|settings\.save|inventory\.|claims\.(list|stats|eligible|setState|setPriority|priorityLog)|attention\.|alloc\.|reports\.|supervisor\.|email\.|demo\.|projects\.|team\.|roster\.|payers\.)/;
const ADMIN_OPS = /^roster\./;
const EDIT_OPS = /^(escalations\.(save|reason)|client\.log(Add|Delete)|monthend\.(set|mark)|clients\.(save|delete|access(Save|Remove))|locations\.|inventory\.(upload|undoBatch|dedupe|enrich\b)|alloc\.|claims\.set|attention\.(answer|clientSent|review)|payers\.saveLimit|reports\.saveArInventory|raci\.save|team\.saveToday)/;
// settings.get / settings.save: who reads and writes which keys (see the two ops).
const SETTINGS_OPEN = ["onedrive_folder"], SETTINGS_LEAD = ["onedrive_folder", "digest_enabled"], SETTINGS_LEAD_SAVE = ["onedrive_folder"];
const SETTINGS_ADMIN_OWN = ["extra_emails", "roster_meta", "feedback_to"];
const SETTINGS_SERVER = /^(cp:|escfile:|odfail:|workbook_status:|live_sync$|floor_sync$|drishti_sync$|shastra_sync$|shastra_log$|wfm_projects$|snap_at$)/;

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
    if (!(await passwordTry(env, u, payload.passHash))) throw new ApiError(401, "That email or password doesn't match. " + triesLeft(u));
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
    throw bad("Accounts come from the Purview Shastra roster. Ask your team lead or admin to add you.");
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
    const rows = await all(env, `SELECT id, name, emp_id, designation, department, email, email_missing, pass_hash, role FROM users
      WHERE active = 1 AND (lower(name) LIKE ? OR lower(emp_id) LIKE ? OR (role = 'admin' AND ? LIKE '%admin%')) ORDER BY role = 'admin' DESC, name LIMIT 8`, like, like, q);
    return { matches: rows.map((u) => ({ id: u.id, name: u.name, emp_id: u.emp_id || "", designation: u.role === "admin" ? "Admin" : u.designation || "", department: u.department || "",
      admin: u.role === "admin", has_password: !!u.pass_hash, email_hint: u.email_missing ? "" : maskEmail(u.email) })) };
  },
  /* Access Admin: a one-time code goes to the admin's mailbox; no password step. */
  "auth.adminCode": async ({ env, payload }) => {
    const u = payload.user_id ? await one(env, "SELECT * FROM users WHERE id = ? AND role = 'admin' AND active = 1", str(payload.user_id, 60))
      : await one(env, "SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at LIMIT 1");
    if (!u) throw bad("No admin account is set up.");
    const code = await issueOtp(env, u.email, "login", {});
    return { user_id: u.id, name: u.name, email_hint: maskEmail(u.email), ...(await deliverOtp(env, u.email, code, "login")) };
  },
  "auth.adminVerify": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ? AND role = 'admin' AND active = 1", str(payload.user_id, 60));
    if (!u) throw bad("No admin account is set up.");
    await checkOtp(env, u.email, payload.code);
    return openSession(env, u, "otp");
  },
  "auth.setupCode": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ? AND active = 1", str(payload.user_id, 60));
    if (!u || u.role === "admin") throw bad("Pick your name from the list first.");
    const extra = ((await getSetting(env, "extra_emails", [])) || []).map(mailClean);
    const mailable = !u.email_missing && mailOk(u.email) && (domainOk(env, u.email) || extra.includes(mailClean(u.email)));
    if (!mailable) return { via: u.locked_at ? "admin" : "lead" };
    const code = await issueOtp(env, u.email, "setup", {});
    const d = await deliverOtp(env, u.email, code, "setup");
    return { via: "email", email_hint: maskEmail(u.email), ...d };
  },
  /* The code proves it is really them (a lead-issued sign-in code counts too); then the password is saved and they are in. */
  "auth.completeSetup": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ? AND active = 1", str(payload.user_id, 60));
    if (!u || u.role === "admin") throw bad("Pick your name from the list first.");
    if (!isHash(payload.passHash)) throw bad("Set a password.");
    await nameSignInOk(env, u);
    const { purpose } = await checkOtp(env, u.email, payload.code);
    if (purpose !== "setup" && purpose !== "login") throw bad("That code is not valid here. Ask for a new one.");
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.passHash);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 0, failed_logins = 0, locked_at = NULL WHERE id = ?").bind(salt, hash, u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
    ]);
    return openSession(env, { ...u, pass_hash: hash, must_change: 0 }, "password");
  },
  /* First sign-in: someone from the roster with no password yet just chooses one (no code). Only while no password is set;
     after that, changing it needs a code (Forgot it?) or a team lead's reset. */
  "auth.firstPassword": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ? AND active = 1", str(payload.user_id, 60));
    if (!u || u.role === "admin") throw bad("Pick your name from the list first.");
    if (!isHash(payload.passHash)) throw bad("Set a password.");
    if (u.pass_hash) throw bad("You already have a password. Sign in with it, or use Forgot it? to reset it.");
    // Live: the first password always needs a one-time code (to the official email, or from the team lead). Demo only skips it.
    if (!env.DEMO) throw bad("First time here: we send a one-time code to your official email (or your team lead gives you one) before you choose a password.");
    await nameSignInOk(env, u);
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.passHash);
    const r = await run(env, "UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 0 WHERE id = ? AND pass_hash = ''", salt, hash, u.id);
    if (!changesOf(r)) throw bad("You already have a password. Sign in with it, or use Forgot it? to reset it.");
    return openSession(env, { ...u, pass_hash: hash, must_change: 0 }, "password");
  },
  "auth.loginById": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ?", str(payload.user_id, 60));
    const fail = () => new ApiError(401, "That password doesn't match.");
    if (!u || !u.active || u.role === "admin") throw fail();
    if (!isHash(payload.passHash)) throw bad("Enter your password.");
    if (!u.pass_hash) throw new ApiError(401, "No password set here yet. Use First time here to create one.");
    if (!(await passwordTry(env, u, payload.passHash))) throw new ApiError(401, "That password doesn't match. " + triesLeft(u));
    await nameSignInOk(env, u);
    return openSession(env, u, "password");
  },
  "auth.logout": async ({ env, token }) => { if (token) await run(env, "DELETE FROM sessions WHERE token = ?", token); return { ok: true }; },
  // with the coming Shastra holidays, so the work form's follow-up date skips them before saving too (the server always does)
  "auth.me": async ({ user }) => { const from = istISO(Date.now() - 86400000);
    return { user: { ...user, scope_view_only: undefined, resp_clients: [...(user.resp_clients || [])] }, holidays: [...HOLIDAYS].filter((d) => d >= from).sort().slice(0, 60) }; },
  "auth.deleteMyAccount": async ({ env, user, payload }) => {
    throw denied("Accounts are removed by the admin only.");
    if (str(payload.confirm, 200).trim().toLowerCase() !== String(user.email || "").toLowerCase()) throw bad("Type your email address exactly to confirm.");
    if (user.role === "supervisor") {
      const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role IN ('supervisor','admin') AND active = 1 AND id <> ?", user.id);
      if (!n.n) throw bad("You are the only active team lead. Add another team lead before deleting this account.");
    }
    await removeUser(env, user.id);
    return { ok: true };
  },
  "auth.savePrefs": async ({ env, user, payload }) => {
    const u = await one(env, "SELECT prefs_json FROM users WHERE id = ?", user.id);
    const next = { ...userPrefs(u && u.prefs_json) };
    for (const k in PREF_KEYS) if (payload[k] !== undefined) { if (!PREF_KEYS[k].includes(payload[k])) throw bad("Unknown setting."); next[k] = payload[k]; }
    await run(env, "UPDATE users SET prefs_json = ? WHERE id = ?", JSON.stringify(next), user.id);
    return { prefs: next };
  },
  "auth.sessions": async ({ env, user, token }) => {
    const r = await one(env, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND token <> ? AND expires_at > ?", user.id, token || "", Date.now());
    return { others: r ? r.n : 0 };
  },
  "auth.signOutOthers": async ({ env, user, token }) => {
    const r = await one(env, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND token <> ?", user.id, token || "");
    await run(env, "DELETE FROM sessions WHERE user_id = ? AND token <> ?", user.id, token || "");
    return { ended: r ? r.n : 0 };
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
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 0, failed_logins = 0, locked_at = NULL WHERE id = ?").bind(salt, hash, user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").bind(user.id, token || ""),
    ]);
    return { ok: true };
  },

  /* ---- users (supervisor) ---- */
  "users.list": async ({ env, user }) => {
    const users = await visibleUsers(env, user);
    // in_span: the people who are theirs (Edit, Sign-in code, Reset password, coaching); the rest are seen through a client only
    const span = user.scope ? new Set((await visibleUsers(env, user, "span")).map((u) => u.id)) : null;
    return { users: users.map((u) => ({ ...publicUser(u), in_span: !span || span.has(u.id) })) };
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
    // People come from Purview Shastra; only the admin adds someone by hand.
    if (!payload.id && !user.is_admin) throw denied("People come from Purview Shastra. Use Sync from Purview Shastra on the Team tab, or ask the admin.");
    if (payload.id) {
      const ex = await one(env, "SELECT * FROM users WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown user.");
      if (!name) throw bad("Enter the person's name.");
      if (!(await inSpan(env, user, ex.id))) throw notYours();
      if (ex.role === "admin") { if (!user.is_admin) throw denied("Only an admin can change an admin account."); role = "admin"; }
      // A new email: for someone the roster had no (or a wrong) address for.
      const newEmail = payload.email != null ? mailClean(payload.email) : ex.email;
      // The Emp ID decides whose Shastra row this account gets at the next roster sync (the other account with it is switched off):
      // the admin's to change, and never to one that another account in use has.
      const empId = payload.emp_id != null ? str(payload.emp_id, 20).trim().toUpperCase() : null;
      const empChanged = empId != null && empId !== String(ex.emp_id || "").trim().toUpperCase();
      // Not the admin: you change only people who report up to you (or billers and desk people on your projects), never your own
      // projects or manager, an email only where it is missing, projects only from your own, and nobody's role up to team lead.
      if (!user.is_admin) {
        const keys = (l) => [...new Set(l.map((x) => projKey(x.name)))].sort().join("|");
        if (ex.id === user.id) { if ((projects && keys(projects) !== keys(jsonList(ex.projects_json))) || (reportsTo !== undefined && reportsTo !== (ex.reports_to || null))) throw denied("Ask the admin to change your own projects or who you report to."); }
        else if (!(await mayActAs(env, user, ex.id))) throw denied("Only an admin, or the person they report to, can change a team lead or manager.");
        if (newEmail !== ex.email && ex.email && !ex.email_missing) throw denied("Only the admin can change an email address.");
        // Roles come from Purview Shastra: only the admin makes someone a team lead, or takes the SME designation (and its limits) off.
        if (role === "supervisor" && ex.role !== "supervisor") throw denied("Only the admin can make someone a team lead. Roles come from Purview Shastra.");
        if (isSME(ex) && !isSME({ ...ex, designation })) throw denied("Only the admin can change an SME's designation. Designations come from Purview Shastra.");
        if (empChanged) throw denied("Only the admin can change an Emp ID: it decides whose Shastra row the account gets.");
        if (projects && user.scope) { const mine = new Set((user.scope_projects || []).map(projKey)); const extra = projects.filter((x) => !mine.has(projKey(x.name)));
          if (extra.length) throw denied("You can only give people your own projects. Not yours: " + extra.map((x) => x.name).join(", ") + "."); }
      }
      // Every check comes before the first write, so a save that is refused changes nothing.
      if (newEmail !== ex.email) {
        if (!mailOk(newEmail)) throw bad("Enter a valid email address.");
        if (await one(env, "SELECT id FROM users WHERE email = ? AND id <> ?", newEmail, ex.id)) throw bad("That email already has an account.");
      }
      if (empChanged && empId) {
        const other = await one(env, "SELECT name FROM users WHERE upper(trim(emp_id)) = ? AND id <> ? AND active = 1 AND (COALESCE(pass_hash, '') <> '' OR last_login IS NOT NULL) LIMIT 1", empId, ex.id);
        if (other) throw bad(`That Emp ID is ${other.name}'s, and their account is in use: at the next roster sync one of the two would be switched off. If this account is to take its place, switch that one off first.`);
      }
      if (ex.id === user.id && (!active || (role !== "supervisor" && role !== "admin"))) throw bad("You can't deactivate or demote your own account.");
      if (ex.role === "supervisor" && (role !== "supervisor" || !active)) {
        const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role IN ('supervisor','admin') AND active = 1 AND id <> ?", ex.id);
        if (!n.n) throw bad("Keep at least one active team lead.");
      }
      const boss = reportsTo ? await one(env, "SELECT name FROM users WHERE id = ?", reportsTo) : null;
      await env.DB.batch([
        ...(newEmail !== ex.email ? [env.DB.prepare("UPDATE users SET email = ?, email_missing = 0, email_typed = ? WHERE id = ?").bind(newEmail, user.is_admin ? 2 : 1, ex.id)] : []),
        ...(empChanged ? [env.DB.prepare("UPDATE users SET emp_id = ? WHERE id = ?").bind(empId, ex.id)] : []),
        ...(projects ? [env.DB.prepare("UPDATE users SET projects_json = ? WHERE id = ?").bind(JSON.stringify(projects), ex.id)] : []),
        ...(reportsTo !== undefined ? [env.DB.prepare("UPDATE users SET reports_to = ?, reports_to_name = ? WHERE id = ?").bind(reportsTo, boss ? boss.name : "", ex.id)] : []),
        env.DB.prepare("UPDATE users SET name = ?, first_name = ?, last_name = ?, designation = ?, role = ?, capacity = ?, active = ? WHERE id = ?").bind(name, first, last, designation, role, capacity, active, ex.id),
        ...(!active ? [env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(ex.id)] : []),
      ]);
      // Switched off here as in a roster sync: their claims go back to the pool and their open hand-offs to the backup.
      if (!active && ex.active) await unassignOpen(env, ex.id);
      if (projects || reportsTo !== undefined || role !== ex.role || active !== ex.active) { await recomputeScopes(env); await syncTeams(env); }
      if (newEmail !== ex.email) await audit(env, user, "user.email", null, `${name}: ${ex.email_missing || !ex.email ? "no email" : ex.email} → ${newEmail}`);
      if (role !== ex.role || active !== ex.active || projects || empChanged) await audit(env, user, "user.save", null, name + (role !== ex.role ? " · role " + ex.role + " → " + role : "") + (active !== ex.active ? (active ? " · reactivated" : " · deactivated") : "")
        + (empChanged ? " · Emp ID " + (ex.emp_id || "none") + " → " + (empId || "none") : "") + (projects ? " · projects " + projects.map((x) => x.name).join(", ") : ""));
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
    await audit(env, user, "user.save", null, `${name} · account added by hand (${role === "supervisor" ? "team lead" : "biller"}, ${email})` + (projects && projects.length ? " · projects " + projects.map((x) => x.name).join(", ") : ""));
    return { user: publicUser(await one(env, "SELECT * FROM users WHERE id = ?", id)) };
  },
  /* A team lead can fetch a sign-in code for someone whose email has not arrived (or when email is not set up). */
  "users.loginCode": async ({ env, user, payload }) => {
    const ex = await one(env, "SELECT id, email, active, name, locked_at FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (ex.locked_at && !user.is_admin) throw denied("This account is locked after wrong passwords. Only the admin, or a code to the person's own official email (Forgot it?), can open it.");
    if (!(await inSpan(env, user, ex.id))) throw notYours();
    if (!(await mayActAs(env, user, ex.id))) throw denied("Only an admin, or the person they report to, can do this for a team lead, manager or admin.");
    if (!ex.active) throw bad("This account is switched off.");
    const code = await issueOtp(env, ex.email, "login", {}, { byTeamLead: true });
    // whoever holds the code can sign in as this person: who asked for it is kept (never the code itself)
    await audit(env, user, "user.code", null, `${ex.name}: sign-in code given`);
    return { email: ex.email, code, expires_in_min: OTP_TTL_MS / 60000 };
  },
  "users.resetPassword": async ({ env, user, payload }) => {
    if (!isHash(payload.passHash)) throw bad("Set a temporary password.");
    const ex = await one(env, "SELECT id, name, locked_at FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (!(await inSpan(env, user, ex.id))) throw notYours();
    if (!(await mayActAs(env, user, ex.id))) throw denied("Only an admin, or the person they report to, can do this for a team lead, manager or admin.");
    if (ex.locked_at && !user.is_admin) throw denied("This account is locked after wrong passwords. Only the admin, or a code to the person's own official email (Forgot it?), can open it.");
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.passHash);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 1, failed_logins = 0, locked_at = NULL WHERE id = ?").bind(salt, hash, ex.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(ex.id),
    ]);
    await audit(env, user, "user.reset", null, `${ex.name}: temporary password set, signed out everywhere`);
    return { ok: true };
  },

  "users.delete": async ({ env, user, payload }) => {
    if (!user.is_admin) throw denied("Only the admin can delete an account.");
    const ex = await one(env, "SELECT * FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (user.scope && !(await visibleUsers(env, user)).some((u) => u.id === ex.id)) throw denied("That person is not on your projects.");
    if (ex.id === user.id) throw bad("To delete your own account, use Delete my account in the menu.");
    if (ex.role === "supervisor" && ex.active) {
      const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role IN ('supervisor','admin') AND active = 1 AND id <> ?", ex.id);
      if (!n.n) throw bad("Keep at least one active team lead.");
    }
    await removeUser(env, ex.id);
    await audit(env, user, "user.delete", null, `${ex.name} · account deleted (${ex.role === "user" ? "biller" : "team lead"}${ex.emp_id ? ", Emp ID " + ex.emp_id : ""})`);
    return { ok: true, name: ex.name };
  },

  /* ---- clients & locations ---- */
  "clients.list": async ({ env, user }) => {
    const clients = (await all(env, "SELECT * FROM clients ORDER BY active DESC, name")).filter((c) => inScope(user, c.id));
    const locs = await all(env, "SELECT * FROM locations ORDER BY active DESC, name");
    const access = user.role === "supervisor" ? await all(env, "SELECT a.client_id, a.user_id, a.level, a.at, a.granted_by_name, u.name, u.designation, u.department, u.active FROM client_access a JOIN users u ON u.id = a.user_id ORDER BY u.name") : [];
    const shape = (r) => { const { team_json, roster_names_json, caps_json, logo, ...rest } = r; return { ...rest, has_logo: !!logo, active: !!r.active, auto_allocate: r.auto_allocate == null ? true : !!r.auto_allocate, team: parseTeam(team_json),
      ...(roster_names_json !== undefined ? { roster_names: jsonList(roster_names_json), caps: jsonObj(caps_json) } : {}) }; };
    const people = await all(env, "SELECT id, name, active FROM users");
    const nm = new Map(people.map((u) => [u.id, u.name])), activeIds = new Set(people.filter((u) => u.active).map((u) => u.id));
    return { services: SERVICES, clients: clients.map((c) => ({ ...shape(c), locations: locs.filter((l) => l.client_id === c.id).map(shape),
      scope_of_work: jsonList(c.scope_json), targets: jsonObj(c.targets_json), od: { link: c.od_link || "", inventory: c.od_inventory_link || "", production: c.od_production_link || "", status: jsonObj(c.od_status_json),
        scopes: Object.fromEntries(Object.entries(jsonObj(c.od_prod_json)).map(([k, v]) => [k, { link: v.link || "", path: v.path || "" }])) }, resp_names: Object.fromEntries(RESP_PEOPLE.map(([, l]) => [l, c[l] ? nm.get(c[l]) || "someone" : ""])),
      profile_gaps: profileGaps(c, locs.filter((l) => l.client_id === c.id && l.active).length, activeIds), team_names: Object.fromEntries(parseTeam(c.team_json).map((id) => [id, nm.get(id) || ""])), responsible_me: !!(user.resp_clients && user.resp_clients.has(c.id)),
      can_edit: user.role === "supervisor" && canEditClient(user, c.id),
      access: access.filter((a) => a.client_id === c.id).map((a) => ({ user_id: a.user_id, name: a.name, designation: a.designation || "", department: a.department || "", active: !!a.active, level: a.level, granted_by_name: a.granted_by_name, at: a.at })) })) };
  },
  /* Make the client's OneDrive folders now (one client, or every client for an admin). */
  "clients.setupFolders": async ({ env, user, payload }) => {
    if (user.role !== "supervisor") throw denied("Supervisor access is needed for this.");
    const ids = payload.client_id ? [str(payload.client_id, 60)] : (user.is_admin || user.access_all ? (await all(env, "SELECT id FROM clients WHERE active = 1 ORDER BY name")).map((r) => r.id) : []);
    if (!ids.length) throw bad("Pick the client.");
    for (const id of ids) editableOr(user, id);
    const tok = await graphAppToken(env);
    const out = [];
    for (const id of ids) { try { const c = await ensureClientFolders(env, id, tok); out.push({ id, ok: true, name: c.name, link: c.od_link }); } catch (e) { out.push({ id, ok: false, error: String(e.message || e).slice(0, 200) }); } }
    return { done: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok), rows: out };
  },
  /* Who changed what on a client profile (and its locations, teams, shares, RACI, month-end), for the supervisors on the client. */
  "clients.history": async ({ env, user, payload }) => {
    if (user.role !== "supervisor") throw denied("The change history is for supervisors.");
    const cid = str(payload.client_id, 60);
    if (!inScope(user, cid)) throw outOfScope();
    const rows = await all(env, "SELECT at, user_name, action, detail FROM audit_log WHERE client_id = ? ORDER BY at DESC LIMIT 200", cid);
    return { rows };
  },
  /* Billers mapped to a client (used when a location has no team of its own) or to a location. */
  /* Payment posting / submission responsibility on the client profile. */
  "clients.saveResponsibility": async ({ env, user, payload }) => {
    const dept = RESP_COLS[payload.dept] ? payload.dept : "";
    if (!dept) throw bad("Pick AR, payment posting, submission, submission follow-up or rejections.");
    const [mcol, lcol, bcol] = RESP_COLS[dept];
    const c = await one(env, "SELECT * FROM clients WHERE id = ?", payload.client_id);
    if (!c) throw bad("Unknown client.");
    editableOr(user, c.id);
    const mode = ["person", "client", "biller", ""].includes(payload.mode) ? payload.mode : "";
    // a part of the scope of work always has a responsible person (the 48-hour recheck may also be the biller who sent it)
    const scope = jsonList(c.scope_json), needed = dept === "subcheck" ? scope.includes("submission") : scope.includes(dept);
    if (needed && !(mode === "person" || (dept === "subcheck" && mode === "biller")))
      throw bad(`${SERVICE_NAME[dept]} is in this client's scope of work, so it needs a responsible person. To stop it, take it out of the scope on the client profile.`);
    const lead = mode === "person" ? str(payload.lead, 60) || null : null, backup = mode === "person" && bcol ? str(payload.backup, 60) || null : null;
    if (mode === "person" && !lead) throw bad("Pick the person responsible.");
    for (const id of [lead, backup].filter(Boolean)) if (!(await one(env, "SELECT id FROM users WHERE id = ? AND active = 1", id))) throw bad("That person is not active.");
    if (bcol) await run(env, `UPDATE clients SET ${mcol} = ?, ${lcol} = ?, ${bcol} = ? WHERE id = ?`, mode, lead, backup, c.id);
    else await run(env, `UPDATE clients SET ${mcol} = ?, ${lcol} = ? WHERE id = ?`, mode, lead, c.id);
    // Open hand-offs follow the new lead / backup.
    if (mode === "person") await followHandoffs(env, c.id, dept, lead, backup);
    const before = await describeProfile(env, c);
    const after = await describeProfile(env, { ...c, [mcol]: mode, [lcol]: lead, ...(bcol ? { [bcol]: backup } : {}) });
    await audit(env, user, "client.responsibility", c.id, diffLines(before, after).join("; ") || SERVICE_NAME[dept] + ": unchanged");
    await noticeResponsibility(env, user, c, c, { ...c, [mcol]: mode, [lcol]: lead, ...(bcol ? { [bcol]: backup } : {}) });
    return { ok: true };
  },
  /* Every active person, name and designation only: for pickers that must reach outside the caller's own span (shares, RACI). */
  "users.directory": async ({ env }) => ({ people: (await all(env, "SELECT id, name, designation, department, role FROM users WHERE active = 1 ORDER BY name")).map((u) => ({
    id: u.id, name: u.name, designation: u.designation || (u.role === "user" ? "Biller" : "Supervisor"), department: u.department || "" })) }),

  /* ---- crossover access: share one client with a person outside its span ---- */
  "clients.accessList": async ({ env, user, payload }) => {
    const clientId = payload.client_id ? str(payload.client_id, 60) : "";
    const userId = payload.user_id ? str(payload.user_id, 60) : "";
    if (!clientId && !userId) throw bad("Pick a client or a person.");
    if (clientId && !inScope(user, clientId)) throw outOfScope();
    const rows = await all(env, `SELECT a.*, u.name, u.designation, u.department, u.active, c.name AS client_name FROM client_access a JOIN users u ON u.id = a.user_id JOIN clients c ON c.id = a.client_id
      WHERE ${clientId ? "a.client_id = ?" : "a.user_id = ?"} ORDER BY c.name, u.name`, clientId || userId);
    return { rows: rows.filter((r) => inScope(user, r.client_id)).map((r) => ({ client_id: r.client_id, client_name: r.client_name, user_id: r.user_id, name: r.name,
      designation: r.designation || "", department: r.department || "", active: !!r.active, level: r.level, granted_by_name: r.granted_by_name, at: r.at })) };
  },
  "clients.accessSave": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60), targetId = str(payload.user_id, 60);
    const level = payload.level === "edit" ? "edit" : "view";
    editableOr(user, clientId);
    if (isSME(user)) throw denied("Sharing a client is for team leads and up. Ask your team lead.");
    if (!(await one(env, "SELECT id FROM clients WHERE id = ?", clientId))) throw bad("Unknown client.");
    const t = await one(env, "SELECT id, name, role, access_all FROM users WHERE id = ? AND active = 1", targetId);
    if (!t) throw bad("Pick an active person.");
    if (t.role === "admin" || t.access_all) throw bad(t.name + " already sees every client.");
    if (t.id === user.id) throw bad("You have this client already.");
    await run(env, `INSERT INTO client_access (id, client_id, user_id, level, granted_by, granted_by_name, at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (client_id, user_id) DO UPDATE SET level = excluded.level, granted_by = excluded.granted_by, granted_by_name = excluded.granted_by_name, at = excluded.at`,
      uuid(), clientId, t.id, level, user.id, user.name, Date.now());
    await audit(env, user, "access.share", clientId, t.name + " · " + (level === "edit" ? "can edit" : "view only"));
    return { ok: true };
  },
  "clients.accessRemove": async ({ env, user, payload }) => {
    editableOr(user, str(payload.client_id, 60));
    if (isSME(user)) throw denied("Sharing a client is for team leads and up. Ask your team lead.");
    await run(env, "DELETE FROM client_access WHERE client_id = ? AND user_id = ?", str(payload.client_id, 60), str(payload.user_id, 60));
    const who = await one(env, "SELECT name FROM users WHERE id = ?", str(payload.user_id, 60));
    await audit(env, user, "access.remove", str(payload.client_id, 60), who ? who.name : str(payload.user_id, 60));
    return { ok: true };
  },

  /* ---- feedback: anyone signed in sends it (with a screenshot and snippets); it is emailed to the feedback people
     (Shreya and Sweety unless the admin picks others) and kept in their Feedback inbox. ---- */
  "feedback.recipients": async ({ env }) => ({ people: (await feedbackRecipients(env)).map((u) => ({ id: u.id, name: u.name })) }),
  "feedback.send": async ({ env, user, payload, ctx: run_ctx }) => {
    const message = str(payload.message, 4000).trim();
    if (!commentOk(message)) throw bad("Write what happened or what you would like, a few words at least.");
    const kind = FEEDBACK_KINDS[payload.kind] ? payload.kind : "bug";
    const now = Date.now();
    const today = await one(env, "SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND at > ?", user.id, now - 86400000);
    if (today && today.n >= 25) throw bad("That is a lot of feedback for one day. Please send the rest tomorrow.");
    const files = (Array.isArray(payload.files) ? payload.files : []).slice(0, 4).map((f) => ({ name: str(f && f.name, 120).replace(/[\\/:*?"<>|]+/g, "-") || "file",
      type: str(f && f.type, 80), b64: String((f && f.b64) || "").replace(/^data:[^,]*,/, "") }));
    let total = 0;
    for (const f of files) {
      if (!FEEDBACK_TYPES.test(f.type)) throw bad("Attach pictures (PNG, JPG, GIF, WebP) or a PDF.");
      if (!/^[A-Za-z0-9+/=]+$/.test(f.b64)) throw bad("One of the files could not be read. Attach it again.");
      if (f.b64.length > 1500000) throw bad(f.name + " is too large. Keep each file under about 1 MB (a screenshot is usually well under).");
      total += f.b64.length;
    }
    if (total > 3600000) throw bad("Together the files are too large. Remove one, or send a smaller screenshot.");
    const id = uuid();
    const page = str(payload.page, 200), ctx = { page, version: str(payload.version, 20), agent: str(payload.agent, 300), screen: str(payload.screen, 30), theme: str(payload.theme, 10) };
    const meta = files.map((f) => ({ id: uuid(), name: f.name, type: f.type, size: Math.round(f.b64.length * 0.75) }));
    const stmts = [env.DB.prepare("INSERT INTO feedback (id, at, user_id, user_name, user_email, kind, message, page, context_json, files_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, now, user.id, user.name || "", user.email || "", kind, message, page, JSON.stringify(ctx), JSON.stringify(meta))];
    files.forEach((f, i) => stmts.push(env.DB.prepare("INSERT INTO feedback_files (id, feedback_id, name, type, data) VALUES (?,?,?,?,?)").bind(meta[i].id, id, f.name, f.type, f.b64)));
    await env.DB.batch(stmts);
    // Email the feedback people. A failed email never loses the feedback: it stays in their inbox.
    const to = (await feedbackRecipients(env)).filter((u) => u.email && !u.email_missing && mailOk(u.email));
    const sent = [], errors = [];
    const mail = async () => {
      if (!env.EMAIL_PROVIDER || !to.length) return;
      const subject = "Brahmastra feedback · " + FEEDBACK_KINDS[kind] + " · from " + (user.name || user.email);
      const text = FEEDBACK_KINDS[kind] + " from " + (user.name || "") + " <" + (user.email || "") + ">\nPage: " + (page || "-") + "\n\n" + message + "\n\n" + (files.length ? files.length + " file(s) attached." : "No files.");
      const html = feedbackHtml({ kind, message, page, user, files: meta, ctx, at: now });
      // All at once, not one after the other.
      await Promise.all(to.map(async (u) => {
        try { await sendEmail(env, { to: u.email, subject, text, html, attachments: files }); sent.push(u.name); }
        catch (e) { errors.push(u.name + ": " + String((e && e.message) || e).slice(0, 160)); }
      }));
    };
    const record = () => run(env, "UPDATE feedback SET emailed_to = ?, email_error = ? WHERE id = ?", sent.join(", "), (!env.EMAIL_PROVIDER ? "Email is not set up on the server." : !to.length ? "Nobody to send it to." : errors.join("; ")).slice(0, 600), id);
    // Saved already: on the live server the emails go out after the reply, so nobody waits on the mail server.
    if (env.EMAIL_PROVIDER && to.length && !env.DEMO && run_ctx && run_ctx.waitUntil) {
      run_ctx.waitUntil(mail().then(record).catch(() => {}));
      return { ok: true, id, saved: true, emailed: [], sending: to.map((u) => u.name), email_error: "" };
    }
    await mail(); await record();
    return { ok: true, id, emailed: sent.sort(), saved: true, email_error: errors.length ? errors.join("; ") : !env.EMAIL_PROVIDER ? "email not set up" : "" };
  },
  "feedback.list": async ({ env, user, payload }) => {
    await feedbackReader(env, user);
    const show = payload.show === "done" ? "done" : payload.show === "all" ? "all" : "new";
    const rows = await all(env, `SELECT * FROM feedback${show === "all" ? "" : " WHERE status = ?"} ORDER BY at DESC LIMIT 200`, ...(show === "all" ? [] : [show]));
    const counts = await one(env, "SELECT SUM(status = 'new') AS n_new, SUM(status = 'done') AS n_done FROM feedback");
    return { rows: rows.map((r) => ({ id: r.id, at: r.at, user_name: r.user_name, user_email: r.user_email, kind: r.kind, kind_label: FEEDBACK_KINDS[r.kind] || r.kind, message: r.message, page: r.page,
      context: jsonObj(r.context_json), files: jsonList(r.files_json), emailed_to: r.emailed_to, email_error: r.email_error, status: r.status, done_by_name: r.done_by_name, done_at: r.done_at })),
      counts: { new: (counts && counts.n_new) || 0, done: (counts && counts.n_done) || 0 }, recipients: (await feedbackRecipients(env)).map((u) => ({ id: u.id, name: u.name })) };
  },
  "feedback.file": async ({ env, user, payload }) => {
    await feedbackReader(env, user);
    const f = await one(env, "SELECT name, type, data FROM feedback_files WHERE id = ?", str(payload.id, 60));
    if (!f) throw bad("That file is no longer there.");
    return { name: f.name, type: f.type, b64: f.data };
  },
  "feedback.setStatus": async ({ env, user, payload }) => {
    await feedbackReader(env, user);
    const done = payload.status === "done";
    await run(env, "UPDATE feedback SET status = ?, done_by_name = ?, done_at = ? WHERE id = ?", done ? "done" : "new", done ? user.name || "" : "", done ? Date.now() : null, str(payload.id, 60));
    return { ok: true };
  },
  "feedback.count": async ({ env, user }) => {
    if (!(await isFeedbackReader(env, user))) return { n: 0, reader: false };
    const r = await one(env, "SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'");
    return { n: (r && r.n) || 0, reader: true };
  },
  "feedback.setRecipients": async ({ env, user, payload }) => {
    if (!user.is_admin) throw denied("Only an admin can change who gets the feedback.");
    const ids = [...new Set((Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 6);
    const ok = ids.length ? (await all(env, `SELECT id FROM users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((u) => u.id) : [];
    await setSetting(env, "feedback_to", ids.filter((x) => ok.includes(x)));
    await audit(env, user, "feedback.recipients", null, (await feedbackRecipients(env)).map((u) => u.name).join(", "));
    return { people: (await feedbackRecipients(env)).map((u) => ({ id: u.id, name: u.name })) };
  },

  /* ---- Team today (team leads): the morning huddle and the live floor on one page ---- */
  /* Any supervisor can pull the roster from Purview Shastra now (Team tab), the same sync the admin and the hourly job run.
     A short pause between syncs keeps a busy morning from asking Shastra again and again. */
  "team.rosterInfo": async ({ env }) => ({ connected: !!env.SHASTRA_FEED_KEY, last: await getSetting(env, "shastra_sync", null) }),
  "team.syncRoster": async ({ env, user }) => {
    const last = await getSetting(env, "shastra_sync", null);
    if (last && last.at && Date.now() - last.at < 120000) {
      const s = Math.ceil((120000 - (Date.now() - last.at)) / 1000);
      throw new ApiError(429, `The roster was synced ${Math.round((Date.now() - last.at) / 1000)} seconds ago${last.by ? " (by " + last.by + ")" : ""}. Try again in ${s} seconds.`);
    }
    const r = await syncShastra(env, user.name || user.email);
    await audit(env, user, "roster.sync", null, `${r.summary ? r.summary.new + " joined, " + r.summary.updated + " changed, " + r.summary.deactivated + " left" : "synced"}`);
    return { summary: r.summary, removed: r.removed, last: await getSetting(env, "shastra_sync", null) };
  },
  /* ---- the Dashboard's team part ----
     Today: the live floor (who is in, pace, on desk, closed today, left over split into high priority and other).
     A date range: each biller's totals for those days against their target. Managers and above can narrow to one team lead. */
  "team.huddle": async ({ env, user, payload }) => {
    const now = Date.now(), today = isoDate(payload.today) || isoToday();
    const off = Math.round(num(payload.tz_offset_min, IST_MIN)), dayStart = Date.parse(today + "T00:00:00Z") - off * 60000;
    const f = await dashTeamFilter(env, user, payload);
    let people = f.people;
    const since = now - 26 * 3600000;
    const cw = f.clientIds ? ` AND c.client_id IN (${f.clientIds.length ? f.clientIds.map(() => "?").join(",") : "NULL"})` : "", ca = f.clientIds || [];
    const lw = f.locationId ? " AND c.location_id = ?" : "", la = f.locationId ? [f.locationId] : [];
    if (f.narrow && people.length) {
      // A client or location picked: the people on it (its team, people it is shared with) and anyone with claims or entries on it.
      const ids = people.map((u) => u.id), qs = ids.map(() => "?").join(",");
      const touched = new Set((await all(env, `SELECT DISTINCT c.assigned_to AS id FROM claims c WHERE c.assigned_to IN (${qs}) AND c.state IN ('assigned','in_progress')${cw}${lw}`, ...ids, ...ca, ...la)).map((x) => x.id));
      (await all(env, `SELECT DISTINCT nt.user_id AS id FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.user_id IN (${qs}) AND nt.created_at > ?${cw}${lw}`, ...ids, since, ...ca, ...la)).forEach((x) => touched.add(x.id));
      people = people.filter((u) => touched.has(u.id) || f.teamIds.has(u.id));
    }
    if (!people.length) return { rows: [], totals: { people: 0 }, leads: f.leads, can_pick_lead: f.canPickLead };
    const ids = people.map((u) => u.id), qs = ids.map(() => "?").join(",");
    const desk = await all(env, `SELECT c.id, c.assigned_to, c.assigned_at, c.state, c.started_at, c.claim_no, c.payer, c.client_id, c.tier, c.balance, c.follow_up_on, cl.name AS client_name FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.state IN ('assigned','in_progress') AND c.assigned_to IN (${qs})${cw}${lw}`, ...ids, ...ca, ...la);
    // a person's entries on every client (the target is theirs, not the picked client's); "here" marks the picked client's
    const notes = await all(env, `SELECT nt.user_id, nt.kind, nt.created_at, ${cw || lw ? `CASE WHEN 1 = 1${cw}${lw} THEN 1 ELSE 0 END` : "1"} AS here FROM notes nt JOIN claims c ON c.id = nt.claim_id
      WHERE nt.kind IN ('work','skip') AND nt.created_at > ? AND nt.user_id IN (${qs})`, ...ca, ...la, since, ...ids);
    const closedRows = await all(env, `SELECT c.last_worked_by AS user_id, c.completed_at FROM claims c WHERE c.state = 'closed' AND c.completed_at > ? AND c.last_worked_by IN (${qs})${cw}${lw}`, since, ...ids, ...ca, ...la);
    const att = new Map((await all(env, `SELECT user_id, status, reason, by_name FROM attendance WHERE day = ? AND user_id IN (${qs})`, today, ...ids)).map((r) => [r.user_id, r]));
    const live = await shastraLive(env);
    const weekdayToday = isWorkDay(today);   // Monday to Friday, not a Shastra holiday
    // a Shastra holiday on a weekday: nobody is expected in, and the page says which holiday (the weekend says weekend)
    let holiday = null;
    if (!weekdayToday && ![0, 6].includes(new Date(today + "T12:00:00Z").getUTCDay())) {
      const hol = await getSetting(env, "holidays", null), h = hol && Array.isArray(hol.rows) ? hol.rows.find((x) => x && x.date === today) : null;
      holiday = { name: h && h.name ? str(h.name, 80) : "" };
    }
    const rows = people.map((u) => {
      // worked and closed today: the person's whole working day (from midnight IST; a night shift's is the day it began, until
      // it is over), as Team status and My day count it; the pace is that day's shift from the roster
      const wday = workDayOf(u.shift, now, today, off), win = wday.shift;
      const mine = notes.filter((n) => n.user_id === u.id && n.created_at >= wday.from && n.created_at < wday.to);
      const work = mine.filter((n) => n.kind === "work"), skips = mine.length - work.length, workHere = work.filter((n) => n.here).length;
      // a night shift belongs to the day it began: one that began on a Sunday (or a holiday) has no target
      const workDay = isWorkDay(wday.day);
      const first = mine.length ? Math.min(...mine.map((n) => n.created_at)) : null, last = mine.length ? Math.max(...mine.map((n) => n.created_at)) : null;
      const onDesk = desk.filter((c) => c.assigned_to === u.id);
      // Left over: allocated before this shift (the one now, or the last one begun) and still not worked; high priority (the
      // High tier) apart from the rest.
      const sw = shiftWindow(u.shift, now, dayStart), startOf = sw ? sw.start : dayStart;
      const left = onDesk.filter((c) => c.assigned_at && c.assigned_at < startOf && c.state === "assigned" && !(c.follow_up_on && c.follow_up_on > today));
      const leftHigh = left.filter((c) => c.tier === "High").length;
      const closed = closedRows.filter((c) => c.user_id === u.id && c.completed_at >= wday.from && c.completed_at < wday.to).length;
      const cur = onDesk.find((c) => c.state === "in_progress") || null;
      const target = Math.max(1, u.capacity || 35);
      const span = win ? win.len : 9 * 3600000, began = win ? win.start : first;
      const elapsed = began ? Math.min(1, Math.max(0, (now - began) / span)) : 0;
      const expected = Math.round(target * elapsed);
      const a = att.get(u.id);
      const inShift = win ? now >= win.start && now <= win.end : !!first;
      // Saturday and Sunday: nobody is expected in (as on Team status); whoever works is counted, with no target
      const offDay = !workDay && !mine.length && !onDesk.some((c) => c.state === "in_progress");
      let status = "not_started";
      if (a && a.status === "out") status = "out";
      else if (cur && cur.started_at && now - cur.started_at < 2 * 3600000) status = "working";
      else if (!onDesk.length && work.length) status = "done";
      else if (last && now - last > 30 * 60000 && inShift) status = "idle";
      else if (work.length) status = "working";
      return { id: u.id, name: u.name, capacity: target, shift: u.shift || "", lead_id: f.leadOf(u).id, lead_name: f.leadOf(u).name, can_act: f.canAct(u.id),
        on_desk: onDesk.length, carried: left.length, left_high: leftHigh, left_other: left.length - leftHigh, closed, worked: work.length, worked_here: f.narrow ? workHere : null, skips, first, last,
        idle_min: last ? Math.floor((now - last) / 60000) : null, expected: workDay ? expected : 0, behind: workDay && status !== "out" && work.length < expected - 3,
        // the open claim only when its client is one of the viewer's: someone seen through a share or a client's team may be on another
        // client's claim, and then nothing of it is shown (claim number, client, payer, balance), only that it is elsewhere
        current: cur ? { ...(inScope(user, cur.client_id) ? { id: cur.id, claim_no: cur.claim_no, client: cur.client_name, payer: cur.payer, balance: cur.balance } : { id: null, claim_no: "", client: "", payer: "", balance: null, elsewhere: true }),
          minutes: cur.started_at ? Math.floor((now - cur.started_at) / 60000) : null } : null,
        status, out: a && a.status === "out" ? { reason: a.reason, by: a.by_name } : null, off_day: offDay, in_shift: inShift,
        untouched: onDesk.filter((c) => c.state === "assigned").length, shastra: live.state === "ok" ? liveState(live.byUser.get(u.id), u, now) : null };
    });
    const rank = { idle: 0, not_started: 1, working: 2, done: 3, out: 4 };
    rows.sort((x, y) => rank[x.status] - rank[y.status] || (y.behind ? 1 : 0) - (x.behind ? 1 : 0) || x.name.localeCompare(y.name));
    const present = rows.filter((r) => r.status !== "out");
    const add = (k) => rows.reduce((t, r) => t + r[k], 0);
    return { rows, weekend: !weekdayToday, holiday, leads: f.leads, can_pick_lead: f.canPickLead, shastra_state: live.state, shastra_error: live.error || "", shastra_at: live.at, totals: { people: rows.length, out: rows.length - present.length, on_desk: add("on_desk"), worked: add("worked"), closed: add("closed"),
      capacity: weekdayToday ? present.reduce((t, r) => t + r.capacity, 0) : 0, in_weekend: weekdayToday ? null : present.filter((r) => !r.off_day).length, carried: add("carried"), left_high: add("left_high"), idle: rows.filter((r) => r.status === "idle").length,
      behind: rows.filter((r) => r.behind).length, working: rows.filter((r) => r.status === "working").length, out_on_desk: rows.filter((r) => r.status === "out").reduce((t, r) => t + r.on_desk, 0) } };
  },
  /* A date range on the Dashboard: each biller's entries, claims closed and call time for those days, against their daily
     target times the weekdays they were in (days marked Out today are left out of the target). */
  "team.range": async ({ env, user, payload }) => {
    const from = isoDate(payload.from), to0 = isoDate(payload.to), today = isoDate(payload.today) || isoToday();
    if (!from || !to0 || from > to0) throw bad("Pick the dates.");
    const to = to0 > today ? today : to0;
    const off = Math.round(num(payload.tz_offset_min, IST_MIN));
    const start = Date.parse(from + "T00:00:00Z") - off * 60000, end = Date.parse(to + "T00:00:00Z") - off * 60000 + 86400000 - 1;
    const f = await dashTeamFilter(env, user, payload);
    const cw = f.clientIds ? ` AND c.client_id IN (${f.clientIds.length ? f.clientIds.map(() => "?").join(",") : "NULL"})` : "", ca = f.clientIds || [];
    const lw = f.locationId ? " AND c.location_id = ?" : "", la = f.locationId ? [f.locationId] : [];
    let people = f.people;
    if (!people.length) return { rows: [], totals: {}, leads: f.leads, can_pick_lead: f.canPickLead, from, to, workdays: 0 };
    const ids = people.map((u) => u.id), qs = ids.map(() => "?").join(",");
    const work = await all(env, `SELECT nt.user_id, COUNT(*) AS worked, COUNT(DISTINCT nt.claim_id) AS claims, SUM(nt.call_min IS NOT NULL) AS calls, COALESCE(SUM(nt.call_min), 0) AS call_min,
        COUNT(DISTINCT date((nt.created_at / 1000) + ?, 'unixepoch')) AS days_worked
      FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ? AND nt.user_id IN (${qs})${cw}${lw} GROUP BY nt.user_id`, off * 60, start, end, ...ids, ...ca, ...la);
    const closed = await all(env, `SELECT c.last_worked_by AS user_id, COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS amt FROM claims c WHERE c.state = 'closed' AND c.completed_at BETWEEN ? AND ?
      AND c.last_worked_by IN (${qs})${cw}${lw} GROUP BY c.last_worked_by`, start, end, ...ids, ...ca, ...la);
    const outs = await all(env, `SELECT user_id, day FROM attendance WHERE status = 'out' AND day BETWEEN ? AND ? AND user_id IN (${qs})`, from, to, ...ids);
    const weekday = isWorkDay;   // Monday to Friday, not a Shastra holiday
    let workdays = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d)) workdays++;
    const wk = new Map(work.map((x) => [x.user_id, x])), cl = new Map(closed.map((x) => [x.user_id, x]));
    if (f.narrow) people = people.filter((u) => wk.has(u.id) || f.teamIds.has(u.id));
    const rows = people.map((u) => {
      const w = wk.get(u.id) || {}, c = cl.get(u.id) || {};
      const out = outs.filter((o) => o.user_id === u.id && weekday(o.day)).length, daysIn = Math.max(0, workdays - out);
      const cap = Math.max(1, u.capacity || 35), target = daysIn * cap;
      return { id: u.id, name: u.name, capacity: cap, lead_id: f.leadOf(u).id, lead_name: f.leadOf(u).name, days_in: daysIn, days_out: out, days_worked: w.days_worked || 0,
        worked: w.worked || 0, claims: w.claims || 0, closed: c.n || 0, closed_amt: c.amt || 0, calls: w.calls || 0, call_min: w.call_min || 0, target, pct: target ? Math.round((w.worked || 0) / target * 100) : null };
    }).sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || a.name.localeCompare(b.name));
    const add = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
    return { rows, leads: f.leads, can_pick_lead: f.canPickLead, from, to, workdays,
      totals: { people: rows.length, worked: add("worked"), closed: add("closed"), closed_amt: add("closed_amt"), calls: add("calls"), call_min: add("call_min"), target: add("target") } };
  },
  /* The team leads a manager can pick on the Dashboard (empty for a team lead). */
  "team.leads": async ({ env, user }) => { const f = await dashTeamFilter(env, user, {}); return { can_pick_lead: f.canPickLead, leads: f.leads }; },
  /* ---- Dashboard › Team status ----
     Each AR biller in this person's span (one team lead's, for a manager who picks one): status from Purview Shastra
     (Production, Training, OJT, Serving notice, Sabbatical), date of joining, ramp-up against the rules, attainment
     (entries against target for the weekdays they were in), floor time needed (8 h a working day, 4 h a half day),
     left over now, the start / end dates and comment kept in Brahmastra, and suggestions in plain pointers.
     Time on floor and idle time come from Purview Shastra once its feed sends them. */
  "team.status": async ({ env, user, payload }) => {
    const from = isoDate(payload.from), to0 = isoDate(payload.to), today = isoDate(payload.today) || isoToday();
    if (!from || !to0 || from > to0) throw bad("Pick the dates.");
    const to = to0 > today ? today : to0;
    const off = Math.round(num(payload.tz_offset_min, IST_MIN)), now = Date.now();
    const start = Date.parse(from + "T00:00:00Z") - off * 60000, end = Date.parse(to + "T00:00:00Z") - off * 60000 + 86400000 - 1;
    const f = await dashTeamFilter(env, user, payload);
    const cw = f.clientIds ? ` AND c.client_id IN (${f.clientIds.length ? f.clientIds.map(() => "?").join(",") : "NULL"})` : "", ca = f.clientIds || [];
    const lw = f.locationId ? " AND c.location_id = ?" : "", la = f.locationId ? [f.locationId] : [];
    let people = f.people;
    const weekday = isWorkDay;   // Monday to Friday, not a Shastra holiday
    const days = [], span = []; for (let d = from; d <= to; d = addDays(d, 1)) { span.push(d); if (weekday(d)) days.push(d); }
    if (!people.length) return { rows: [], leads: f.leads, can_pick_lead: f.canPickLead, from, to, workdays: days.length, totals: { people: 0 }, by_status: [], checks: [], suggestions: { today: [], week: [], good: [] }, floor_source: "pending" };
    const ids = people.map((u) => u.id), qs = ids.map(() => "?").join(",");
    // A night shift's hours and entries belong to the day it began (to its end and a little after: dayRollMin); while it is
    // still under way after midnight, that day is the person's today and is not finished yet (workDayOf).
    const wdOf = new Map(people.map((u) => [u.id, workDayOf(u.shift, now, today, off)])), dayOf = (u) => wdOf.get(u.id).day;
    const rolls = new Map(); for (const u of people) { const r = wdOf.get(u.id).roll; if (r) rolls.set(r, [...(rolls.get(r) || []), u.id]); }
    const maxRollMs = Math.max(0, ...rolls.keys()) * 60000, rollArgs = [...rolls.values()].flat();
    const rollSql = (col) => rolls.size ? `CASE ${[...rolls.keys()].map((r) => `WHEN ${col} IN (${rolls.get(r).map(() => "?").join(",")}) THEN ${r * 60}`).join(" ")} ELSE 0 END` : "0";
    const late = people.filter((u) => dayOf(u) < today).map((u) => u.id);
    const doneSql = late.length ? `CASE WHEN user_id IN (${late.map(() => "?").join(",")}) THEN ? ELSE ? END` : "?", doneArgs = late.length ? [...late, addDays(today, -1), today] : [today];
    // escalations where the person is named as who made the error (our error), received in these dates
    const ew = f.clientIds ? ` AND e.client_id IN (${f.clientIds.length ? f.clientIds.map(() => "?").join(",") : "NULL"})` : "";
    const [work, closed, att, notes, desk, outNow, escs, tasksDone, tasksClosed] = await Promise.all([
      // a person's entries on every client: picking a client or a team lead shows who is on it, never cuts their own attainment
      // (the entries on the picked client are counted beside); a night shift's entries after midnight go to the day it began
      all(env, `SELECT user_id, COUNT(*) AS worked, SUM(bday < ${doneSql}) AS worked_done, COUNT(DISTINCT bday) AS days_worked, SUM(here) AS worked_here FROM (
          SELECT nt.user_id, date((nt.created_at / 1000) + ? - ${rollSql("nt.user_id")}, 'unixepoch') AS bday, ${cw || lw ? `CASE WHEN 1 = 1${cw}${lw} THEN 1 ELSE 0 END` : "1"} AS here
          FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ? AND nt.user_id IN (${qs}))
        WHERE bday BETWEEN ? AND ? GROUP BY user_id`, ...doneArgs, off * 60, ...rollArgs, ...ca, ...la, start, end + maxRollMs, ...ids, from, to),
      all(env, `SELECT c.last_worked_by AS user_id, COUNT(*) AS n FROM claims c WHERE c.state = 'closed' AND c.completed_at BETWEEN ? AND ? AND c.last_worked_by IN (${qs})${cw}${lw} GROUP BY c.last_worked_by`, start, end, ...ids, ...ca, ...la),
      all(env, `SELECT user_id, day, reason FROM attendance WHERE status = 'out' AND day BETWEEN ? AND ? AND user_id IN (${qs})`, from, to, ...ids),
      all(env, `SELECT * FROM team_notes WHERE user_id IN (${qs})`, ...ids),
      // left over: allocated before the person's working day began (a night shift's: the day it began) and not started
      all(env, `SELECT c.assigned_to, c.tier, c.assigned_at FROM claims c WHERE c.state = 'assigned' AND c.assigned_at < ? AND (c.follow_up_on IS NULL OR c.follow_up_on = '' OR c.follow_up_on <= ?) AND c.assigned_to IN (${qs})${cw}${lw}`,
        Math.max(...people.map((u) => wdOf.get(u.id).from)), today, ...ids, ...ca, ...la),
      all(env, `SELECT user_id, reason FROM attendance WHERE status = 'out' AND day = ? AND user_id IN (${qs})`, today, ...ids),
      all(env, `SELECT e.id, e.error_by_id AS user_id, e.sr, e.client_id, cl.name AS client_name, e.kind, e.dept, e.day, e.error_dow, e.status FROM escalations e LEFT JOIN clients cl ON cl.id = e.client_id
        WHERE e.is_error = 'Y' AND e.error_by_id IN (${qs}) AND e.day BETWEEN ? AND ?${ew} ORDER BY e.day DESC, e.sr DESC`, ...ids, from, to, ...ca),
      // team tasks: the items each person marked done in these dates (what each update added), on the day the update was made
      // (a night shift's after midnight to the day it began); they count toward the person's count beside the claims
      all(env, `SELECT user_id, SUM(delta) AS items, SUM(CASE WHEN bday < ${doneSql} THEN delta ELSE 0 END) AS items_done, COUNT(DISTINCT task_id) AS tasks FROM (
          SELECT u.user_id, u.delta, u.task_id, date((u.at / 1000) + ? - ${rollSql("u.user_id")}, 'unixepoch') AS bday
          FROM team_task_updates u WHERE u.kind = 'update' AND u.at BETWEEN ? AND ? AND u.user_id IN (${qs}))
        WHERE bday BETWEEN ? AND ? GROUP BY user_id`, ...doneArgs, off * 60, ...rollArgs, start, end + maxRollMs, ...ids, from, to),
      all(env, `SELECT user_id, COUNT(*) AS n FROM team_task_people WHERE status = 'completed' AND completed_at BETWEEN ? AND ? AND user_id IN (${qs}) GROUP BY user_id`, start, end, ...ids),
    ]);
    const tkd = new Map(tasksDone.map((x) => [x.user_id, x])), tkc = new Map(tasksClosed.map((x) => [x.user_id, x.n]));
    const escBy = new Map(); for (const e of escs) { if (!escBy.has(e.user_id)) escBy.set(e.user_id, []); escBy.get(e.user_id).push({ id: e.id, sr: e.sr, client_id: e.client_id, client_name: e.client_name || "",
      kind: escKind(e), dept: e.dept, day: e.day, dow: e.error_dow || "", status: e.status === "resolved" ? "Closed" : "Open" }); }
    const outToday = new Map(outNow.map((x) => [x.user_id, /half/i.test(x.reason || "") ? "half" : "out"]));
    const wk = new Map(work.map((x) => [x.user_id, x])), cl = new Map(closed.map((x) => [x.user_id, x.n])), nb = new Map(notes.map((x) => [x.user_id, x]));
    // time on the floor and idle time from Purview Shastra (and its attendance for each day), when its feed is set up
    let fl; try { fl = await shastraFloor(env, from, to, today, off); } catch (e) { fl = { state: "error", error: str(e && e.message, 200), byUser: new Map() }; }
    if (f.narrow) people = people.filter((u) => (wk.get(u.id) && wk.get(u.id).worked_here) || f.teamIds.has(u.id));
    const statusOf = (u) => { const st = String(u.roster_status || "").trim().toLowerCase();
      return st === "training" ? "Training" : st === "ojt" ? "OJT" : st === "sabbatical" ? "Sabbatical" : /notice/.test(st) ? "Serving notice" : "Production"; };
    const rows = people.map((u) => {
      const w = wk.get(u.id) || {}, n = nb.get(u.id) || {}, st = statusOf(u), cap = Math.max(1, u.capacity || 35);
      // each day: a full day, a half day or out. Purview Shastra's attendance decides when it has the day (leave, half
      // day, week off, a Saturday worked); otherwise a weekday is a full day unless marked Out today here (Half day: half).
      // Days before the date of joining have no target and no floor time, and are not days out.
      const fd = fl.byUser.get(u.id), myDay = dayOf(u), doj = isoDate(u.doj);
      let full = 0, half = 0, out = 0, unplanned = 0, tDone = 0, tToday = 0, shares = 0, needAll = 0, needDone = 0, onAll = 0, onDone = 0, idleAll = 0, idleDone = 0, lockedAll = 0, guard = false, brkAll = 0, brkDays = 0, brkOver = 0;
      for (const d of span) {
        const x = fd && fd.get(d), sd0 = x ? shastraDay(x.status) : null, wd = weekday(d);
        // Overtime on a working day is a day in; a weekend or holiday worked as overtime adds no target (its entries still count)
        const sd = sd0 && sd0.overtime && !wd ? null : sd0;
        let share = 0;
        if (!(doj && d < doj)) {
          if (sd) { share = sd.share; if (sd.kind === "in") full++; else if (sd.kind === "half") half++; else if (sd.kind !== "off") { out++; if (sd.kind === "unplanned") unplanned++; } }
          else if (wd) { const a = att.find((y) => y.user_id === u.id && y.day === d); share = !a ? 1 : /half/i.test(a.reason || "") ? 0.5 : 0;
            if (!a) full++; else if (share) half++; else { out++; unplanned++; } }
        }
        shares += share; needAll += share * 480;
        if (d < myDay) { tDone += share * cap; needDone += share * 480; } else if (d === myDay) tToday = share * cap;
        if (x) { const tof = x.tof_min || 0, idl = x.guard ? (x.idle_min || 0) + (x.locked_min || 0) : 0;
          onAll += tof; idleAll += idl; if (x.guard) { lockedAll += x.locked_min || 0; guard = true; }
          // breaks taken that day (Shastra's own figure); Shastra allows 60 minutes a day
          brkAll += x.break_min || 0; if (tof > 0) brkDays++; if ((x.break_min || 0) > SH_BREAK_ALLOW_MIN) brkOver++;
          if (d < myDay) { onDone += tof; idleDone += idl; } }
      }
      const target = Math.round(shares * cap);
      const inShastra = fl.state === "ok" && !!fd && fd.size > 0;
      const worked = w.worked || 0, workedDone = w.worked_done || 0, workedToday = worked - workedDone;
      // team task items count toward the person's count (and so their attainment), next to the claims they worked
      const tk = tkd.get(u.id) || {}, taskItems = Math.max(0, tk.items || 0), taskDone = Math.max(0, Math.min(taskItems, tk.items_done || 0)), taskToday = taskItems - taskDone;
      const countDone = workedDone + taskDone, countToday = workedToday + taskToday;
      // Attainment on the days already finished (up to yesterday), so a day still under way does not make everyone look behind;
      // with only today in the dates, today against today's target.
      const basis = tDone > 0 ? "done" : "today";
      // one decimal, judged on the figure shown (89.7% is below a 90% mark, not "90%")
      const attain = basis === "done" ? Math.round(countDone / tDone * 1000) / 10 : tToday ? Math.round(countToday / tToday * 1000) / 10 : null;
      // ramp-up: Training and OJT are due in production 6 weeks (4 training + 2 OJT) from their start (the start date kept here,
      // otherwise the date of joining); an end date kept here is the date agreed instead (an extension or an earlier move)
      const startD = n.start_date || u.doj || "";
      let ramp = { kind: st === "Production" ? "prod" : st === "Training" || st === "OJT" ? "ramp" : "other" };
      if (ramp.kind === "ramp") {
        const due = n.end_date || (startD ? addDays(startD, RAMP_WEEKS * 7) : "");
        if (!due) ramp = { kind: "ramp", flag: "nodate" };
        else { const left = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
          ramp = { kind: "ramp", start: startD, due, extended: !!n.end_date, weeks_in: startD ? Math.max(0, Math.round((Date.parse(today) - Date.parse(startD)) / 86400000 / 7 * 10) / 10) : null,
            flag: left < 0 ? "over" : left <= 7 ? "soon" : "track", days: left }; }
      }
      // left over: what was on the person's desk before this working day began (a night shift's day begins at its shift: B-03)
      const mine = desk.filter((c) => c.assigned_to === u.id && c.assigned_at < wdOf.get(u.id).from), leftHigh = mine.filter((c) => c.tier === "High").length;
      // can_act: the viewer has power over this person only inside their own span (D-01)
      return { id: u.id, name: u.name, lead_id: f.leadOf(u).id, lead_name: f.leadOf(u).name, can_act: f.canAct(u.id), doj: u.doj || "", status: st, capacity: cap,
        days_full: full, days_half: half, days_out: out, days_unplanned: unplanned, days_worked: w.days_worked || 0, worked, closed: cl.get(u.id) || 0, target, attain, attain_basis: basis,
        worked_here: f.narrow ? w.worked_here || 0 : null,
        worked_done: workedDone, target_done: Math.round(tDone * 10) / 10, worked_today: workedToday, target_today: tToday,
        task_items: taskItems, task_items_done: taskDone, task_items_today: taskToday, tasks_worked: tk.tasks || 0, tasks_completed: tkc.get(u.id) || 0,
        count: worked + taskItems, count_done: countDone, count_today: countToday,
        // floor time: 8 h a working day, 4 h a half day; met or short on the finished days (a day under way is not judged)
        floor_needed_min: needAll, floor_needed_done_min: needDone,
        on_floor_min: inShastra ? onAll : null, on_floor_done_min: inShastra ? onDone : null,
        idle_min: inShastra && guard ? idleAll : null, idle_done_min: inShastra && guard ? idleDone : null, locked_min: inShastra && guard ? lockedAll : null, guard,
        break_min: inShastra ? brkAll : null, break_days: brkDays, break_over_days: brkOver,
        floor: fl.state !== "ok" ? "none" : !inShastra ? "no_attendance" : needDone <= 0 ? "pending" : onDone >= needDone ? "met" : "short",
        floor_short_min: inShastra && needDone > onDone ? needDone - onDone : 0,
        left: mine.length, left_high: leftHigh, left_other: mine.length - leftHigh, ramp,
        // judged against the production mark: production only, on finished days; Training and OJT are in ramp-up
        perf: ramp.kind === "ramp" ? "ramp" : st !== "Production" ? "other" : attain == null ? (worked + taskItems > 0 ? "notarget" : "none") : basis === "today" ? "pending" : attain < PERF_MARK ? "below" : "ok",
        out_today: outToday.get(u.id) || "",
        escalations: escBy.get(u.id) || [], esc_n: (escBy.get(u.id) || []).length,
        esc_ext: (escBy.get(u.id) || []).filter((e) => e.kind === "external").length, esc_int: (escBy.get(u.id) || []).filter((e) => e.kind === "internal").length,
        start_date: n.start_date || "", end_date: n.end_date || "", comment: n.comment || "", comment_by: n.by_name || "", comment_at: n.at || null };
    }).sort((a, b) => (a.lead_name || "~").localeCompare(b.lead_name || "~") || a.name.localeCompare(b.name));
    const sum = (k, rs = rows) => rs.reduce((t, r) => t + (r[k] || 0), 0);
    const byStatus = [...new Set(rows.map((r) => r.status))].map((st) => { const rs = rows.filter((r) => r.status === st), wkd = sum("worked", rs), tg = sum("target", rs), dw = sum("days_worked", rs);
      const wd = sum("count_done", rs), td = sum("target_done", rs), wt = sum("count_today", rs), tt = sum("target_today", rs);
      // claims and target on the same days as the attainment: the finished days, or today when only today is picked
      return { status: st, people: rs.length, worked: td > 0 ? wd : wt, target: td > 0 ? Math.round(td) : tt, all_worked: wkd, all_target: tg, task_items: sum("task_items", rs),
        attain: td > 0 ? Math.round(wd / td * 1000) / 10 : tt ? Math.round(wt / tt * 1000) / 10 : null, per_day: dw ? Math.round(wkd / dw * 10) / 10 : null }; })
      .sort((a, b) => b.people - a.people);
    // roster checks: what would make these figures wrong
    const checks = [];
    const noDoj = rows.filter((r) => !r.doj); if (noDoj.length) checks.push({ n: noDoj.length, text: (noDoj.length === 1 ? "person" : "people") + " with no date of joining: " + noDoj.slice(0, 4).map((r) => r.name).join(", ") });
    const noLead = rows.filter((r) => !r.lead_id); if (noLead.length) checks.push({ n: noLead.length, text: (noLead.length === 1 ? "biller" : "billers") + " with no team lead on the roster" });
    const seen = new Map(); rows.forEach((r) => { const k = r.name.trim().toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); });
    const dup = [...seen.values()].filter((v) => v > 1).length; checks.push({ n: dup, text: "names that appear twice" });
    if (fl.state === "ok") {
      const noAtt = rows.filter((r) => r.floor === "no_attendance");
      checks.push({ n: noAtt.length, text: (noAtt.length === 1 ? "person" : "people") + " with no attendance in Purview Shastra for these dates" + (noAtt.length ? ": " + noAtt.slice(0, 4).map((r) => r.name).join(", ") + (noAtt.length > 4 ? "…" : "") : "") });
      const noGuard = rows.filter((r) => r.on_floor_min != null && !r.guard);
      if (noGuard.length) checks.push({ n: noGuard.length, text: (noGuard.length === 1 ? "person" : "people") + " with no Shastra Guard machine linked (no idle time): " + noGuard.slice(0, 4).map((r) => r.name).join(", ") + (noGuard.length > 4 ? "…" : "") });
    }
    const totals = { people: rows.length, leads: new Set(rows.map((r) => r.lead_id).filter(Boolean)).size, production: rows.filter((r) => r.status === "Production").length,
      training: rows.filter((r) => r.status === "Training" || r.status === "OJT").length, ramp_over: rows.filter((r) => r.ramp.flag === "over").length,
      below: rows.filter((r) => r.perf === "below").length, worked: sum("worked"), target: sum("target"), floor_needed_min: sum("floor_needed_min"),
      worked_done: sum("worked_done"), target_done: sum("target_done"), worked_today: sum("worked_today"), target_today: sum("target_today"),
      on_floor_min: rows.some((r) => r.on_floor_min != null) ? sum("on_floor_min") : null, idle_min: rows.some((r) => r.idle_min != null) ? sum("idle_min") : null,
      break_min: rows.some((r) => r.break_min != null) ? sum("break_min") : null, break_over_days: sum("break_over_days"),
      floor_judged: rows.filter((r) => r.floor === "met" || r.floor === "short").length, floor_met: rows.filter((r) => r.floor === "met").length,
      esc: sum("esc_n"), esc_ext: sum("esc_ext"), esc_int: sum("esc_int"), esc_people: rows.filter((r) => r.esc_n).length,
      task_items: sum("task_items"), tasks_completed: sum("tasks_completed"), count_done: sum("count_done"), count_today: sum("count_today") };
    totals.attain_basis = totals.target_done > 0 ? "done" : "today";
    totals.attain = totals.attain_basis === "done" ? Math.round(totals.count_done / totals.target_done * 1000) / 10 : totals.target_today ? Math.round(totals.count_today / totals.target_today * 1000) / 10 : null;
    return { rows, leads: f.leads, can_pick_lead: f.canPickLead, from, to, workdays: days.length, totals, by_status: byStatus, checks, perf_mark: PERF_MARK, ramp_weeks: RAMP_WEEKS,
      suggestions: teamSuggestions(rows), floor_source: fl.state, floor_error: fl.error || "", floor_at: fl.at || null };
  },
  /* The start / end dates and comment on someone's Team status row: kept in Brahmastra, seen by every lead who sees them. */
  "team.saveNote": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60);
    if (!(await visibleUsers(env, user, "edit")).some((u) => u.id === id)) throw denied("That person is not in your team.");
    const start = payload.start_date ? isoDate(payload.start_date) : "", end = payload.end_date ? isoDate(payload.end_date) : "";
    if (payload.start_date && !start) throw bad("The start date is not a date.");
    if (payload.end_date && !end) throw bad("The end date is not a date.");
    if (start && end && end < start) throw bad("The end date is before the start date.");
    const comment = str(payload.comment, 500).trim();
    await run(env, `INSERT INTO team_notes (user_id, start_date, end_date, comment, by_name, at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date, comment = excluded.comment, by_name = excluded.by_name, at = excluded.at`, id, start, end, comment, user.name || "", Date.now());
    const who = await one(env, "SELECT name FROM users WHERE id = ?", id);
    await audit(env, user, "team.note", null, (who ? who.name : id) + ": " + [start ? "start " + start : "", end ? "end " + end : "", comment ? "comment: " + comment : ""].filter(Boolean).join(" · "));
    return { ok: true };
  },
  /* The claims activity for the Dashboard's dates (the inventory figures themselves are always as of now). */
  "team.activity": async ({ env, user, payload }) => {
    const from = num(payload.from_ms, 0), to = num(payload.to_ms, Date.now());
    const lc = await leadClientIds(env, user, payload.lead_id);
    const where = [], args = [];
    if (user.scope) { where.push(`c.client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); args.push(...user.scope); }
    if (lc) { where.push(`c.client_id IN (${lc.length ? lc.map(() => "?").join(",") : "NULL"})`); args.push(...lc); }
    if (payload.client_id) { where.push("c.client_id = ?"); args.push(str(payload.client_id, 60)); }
    if (payload.location_id) { where.push("c.location_id = ?"); args.push(str(payload.location_id, 60)); }
    const w = where.length ? " AND " + where.join(" AND ") : "";
    const [work, closed, loaded, assigned] = await Promise.all([
      one(env, `SELECT COUNT(*) AS n, COUNT(DISTINCT nt.claim_id) AS claims FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ?${w}`, from, to, ...args),
      one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS amt FROM claims c WHERE c.state = 'closed' AND c.completed_at BETWEEN ? AND ?${w}`, from, to, ...args),
      one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS amt FROM claims c WHERE c.created_at BETWEEN ? AND ?${w}`, from, to, ...args),
      one(env, `SELECT COUNT(*) AS n FROM claims c WHERE c.assigned_at BETWEEN ? AND ?${w}`, from, to, ...args),
    ]);
    return { worked: work.n || 0, claims_worked: work.claims || 0, closed_n: closed.n || 0, closed_amt: closed.amt || 0, loaded_n: loaded.n || 0, loaded_amt: loaded.amt || 0, assigned_n: assigned.n || 0 };
  },
  "team.setOut": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60), today = isoDate(payload.today) || isoToday();
    if (!(await visibleUsers(env, user, "edit")).some((u) => u.id === id)) throw denied("That person is not in your team.");
    if (payload.out === false) await run(env, "DELETE FROM attendance WHERE user_id = ? AND day = ?", id, today);
    else await run(env, `INSERT INTO attendance (user_id, day, status, reason, by_name, at) VALUES (?,?,'out',?,?,?) ON CONFLICT (user_id, day) DO UPDATE SET status = 'out', reason = excluded.reason, by_name = excluded.by_name, at = excluded.at`,
      id, today, str(payload.reason, 120).trim(), user.name || "", Date.now());
    return { ok: true };
  },
  /* The not-logged-in alert: Remind me in 30 min (for this person only) or They told me (for everyone, for the day). */
  "team.alertSnooze": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60);
    if (!(await visibleUsers(env, user, "edit")).some((u) => u.id === id)) throw denied("That person is not in your team.");
    const live = await shastraLive(env), mins = Math.min(240, Math.max(5, Math.round(num(payload.minutes, 30)))), now = Date.now();
    await run(env, `INSERT INTO shastra_alerts (user_id, day, by_id, state, until_at, by_name, at) VALUES (?,?,?,'snoozed',?,?,?) ON CONFLICT (user_id, day, by_id) DO UPDATE SET state = 'snoozed', until_at = excluded.until_at, at = excluded.at`,
      id, live.day || istISO(now), user.id, now + mins * 60000, user.name || "", now);
    return { ok: true, until_at: now + mins * 60000 };
  },
  "team.alertDismiss": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60);
    const u = (await visibleUsers(env, user, "edit")).find((x) => x.id === id);
    if (!u) throw denied("That person is not in your team.");
    const live = await shastraLive(env), now = Date.now();
    await run(env, `INSERT INTO shastra_alerts (user_id, day, by_id, state, until_at, by_name, at) VALUES (?,?,?,'dismissed',NULL,?,?) ON CONFLICT (user_id, day, by_id) DO UPDATE SET state = 'dismissed', at = excluded.at`, id, live.day || istISO(now), user.id, user.name || "", now);
    await audit(env, user, "team.alert", null, `${u.name}: not logged in, dismissed (${str(payload.reason, 80) || "the team lead knows"})`);
    return { ok: true };
  },
  /* Not logged in: hand the person's untouched claims out equally to the people in today on the same clients, and
     (unless asked not to) mark them out today. Each person who gets claims is told. */
  "team.shareOut": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60), today = isoDate(payload.today) || istISO(Date.now());
    if (user.role !== "supervisor") throw denied("Only team leads and above can reallocate.");
    const src = (await visibleUsers(env, user, "edit")).find((u) => u.id === id && u.role === "user");
    if (!src) throw denied("That person is not in your team.");
    const live = await shastraLive(env);
    const res = await shareEqually(env, user, src, { live, today, via: "not logged in", reason: payload.mark_out === false ? "reallocated" : "not logged in today" });
    if (payload.mark_out !== false) await run(env, `INSERT INTO attendance (user_id, day, status, reason, by_name, at) VALUES (?,?,'out',?,?,?) ON CONFLICT (user_id, day) DO UPDATE SET status = 'out', reason = excluded.reason, by_name = excluded.by_name, at = excluded.at`,
      id, today, "Not logged in to Shastra", user.name || "", Date.now());
    if (res.moved || payload.mark_out !== false) await audit(env, user, "team.rebalance", null, `${src.name} (not logged in): ${res.moved} claims shared equally` + (res.to.length ? " to " + res.to.map((x) => x.name + " " + x.count).join(", ") : "") + (res.left ? `; ${res.left} stayed` : ""));
    return { moved: res.moved, left: res.left, to: res.to.map(({ name, count }) => ({ name, count })), marked_out: payload.mark_out !== false };
  },
  "notify.seen": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 50);
    if (ids.length) await run(env, `UPDATE user_notices SET seen_at = ? WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`, Date.now(), user.id, ...ids);
    return { ok: true };
  },
  /* Hands an absent biller's untouched claims (assigned, not started) to the people on the same client who are in
     today: the same number each, highest priority first (see shareEqually). */
  "team.rebalance": async ({ env, user, payload }) => {
    const from = str(payload.user_id, 60), today = isoDate(payload.today) || istISO(Date.now());
    const src = (await visibleUsers(env, user, "edit")).filter((u) => u.role === "user" && u.active).find((u) => u.id === from);
    if (!src) throw denied("That person is not in your team.");
    const res = await shareEqually(env, user, src, { live: await shastraLive(env), today, via: "rebalance", reason: "out today" });
    if (res.moved) await audit(env, user, "team.rebalance", null, `${src.name}: ${res.moved} claims shared equally to ` + res.to.map((x) => x.name + " " + x.count).join(", "));
    return { moved: res.moved, left: res.left, to: res.to.map(({ name, count }) => ({ name, count })) };
  },
  /* Coaching: one biller's last 30 days and the team lead's 1:1 notes. */
  "coach.profile": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60);
    const u = (await visibleUsers(env, user, "span")).find((x) => x.id === id);
    if (!u) throw denied("That person is not in your team.");
    const now = Date.now(), since = now - 30 * 86400000;
    const days = await all(env, "SELECT date((created_at / 1000) + ?, 'unixepoch') AS day, SUM(kind = 'work') AS work, SUM(kind = 'skip') AS skips FROM notes WHERE user_id = ? AND created_at > ? GROUP BY day ORDER BY day", IST_MIN * 60, id, since);
    const statuses = await all(env, "SELECT COALESCE(NULLIF(status, ''), status_code) AS status, COUNT(*) AS n FROM notes WHERE user_id = ? AND kind = 'work' AND created_at > ? GROUP BY 1 ORDER BY n DESC LIMIT 6", id, since);
    const esc = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE escalated_by = ? AND escalated_at > ?", id, since);
    const back = await one(env, "SELECT COUNT(*) AS n FROM handoffs WHERE created_by = ? AND status = 'back' AND created_at > ?", id, since);
    const sent = await one(env, "SELECT COUNT(*) AS n FROM handoffs WHERE created_by = ? AND created_at > ?", id, since);
    const carried = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'assigned' AND assigned_at < ?", id, now - 86400000);
    const notesLen = await one(env, "SELECT AVG(LENGTH(comment)) AS len FROM notes WHERE user_id = ? AND kind = 'work' AND created_at > ?", id, since);
    const out = await all(env, "SELECT day FROM attendance WHERE user_id = ? AND day >= ? AND status = 'out'", id, istISO(since));
    const cn = await all(env, "SELECT id, at, kind, text, by_name, by_id FROM coach_notes WHERE user_id = ? ORDER BY at DESC LIMIT 40", id);
    const workDays = days.filter((d) => d.work > 0);
    const avg = workDays.length ? Math.round(workDays.reduce((t, d) => t + d.work, 0) / workDays.length * 10) / 10 : 0;
    return { person: { id: u.id, name: u.name, designation: u.designation || "", capacity: u.capacity || 35, shift: u.shift || "", doj: u.doj || "", reports_to_name: u.reports_to_name || "" },
      days, avg_per_day: avg, worked_days: workDays.length, entries: days.reduce((t, d) => t + d.work, 0), skips: days.reduce((t, d) => t + d.skips, 0),
      statuses, escalations: (esc && esc.n) || 0, handoffs_sent: (sent && sent.n) || 0, handed_back: (back && back.n) || 0, carried: (carried && carried.n) || 0,
      note_len: notesLen && notesLen.len ? Math.round(notesLen.len) : 0, out_days: out.length, notes: cn.map((n) => ({ ...n, mine: n.by_id === user.id })) };
  },
  "coach.noteAdd": async ({ env, user, payload }) => {
    const id = str(payload.user_id, 60);
    if (!(await visibleUsers(env, user, "span")).some((x) => x.id === id)) throw denied("That person is not in your team.");
    const kind = ["one_to_one", "praise", "concern", "goal"].includes(payload.kind) ? payload.kind : "one_to_one";
    const text = str(payload.text, 2000).trim();
    if (!commentOk(text)) throw bad("Write what was discussed or agreed, a few words at least.");
    await run(env, "INSERT INTO coach_notes (id, user_id, at, kind, text, by_id, by_name) VALUES (?,?,?,?,?,?,?)", uuid(), id, Date.now(), kind, text, user.id, user.name || "");
    return { ok: true };
  },
  "coach.noteDelete": async ({ env, user, payload }) => {
    const n = await one(env, "SELECT * FROM coach_notes WHERE id = ?", str(payload.id, 60));
    if (!n) throw bad("That note is no longer there.");
    if (n.by_id !== user.id && !user.is_admin) throw denied("Only the person who wrote it can remove it.");
    await run(env, "DELETE FROM coach_notes WHERE id = ?", n.id);
    return { ok: true };
  },
  /* Note templates, written by team leads, inserted by billers into RCA / findings. */
  "templates.list": async ({ env, user, payload }) => {
    const cid = payload.client_id ? str(payload.client_id, 60) : "";
    const rows = await all(env, `SELECT t.*, c.name AS client_name FROM note_templates t LEFT JOIN clients c ON c.id = t.client_id WHERE t.client_id IS NULL${cid ? " OR t.client_id = ?" : " OR 1 = 1"} ORDER BY t.title`, ...(cid ? [cid] : []));
    return { rows: rows.filter((r) => !r.client_id || inScope(user, r.client_id)).map((r) => ({ id: r.id, client_id: r.client_id, client_name: r.client_name || "", title: r.title, text: r.text, by_name: r.by_name, at: r.at })) };
  },
  "templates.save": async ({ env, user, payload }) => {
    if (user.role !== "supervisor" || isSME(user)) throw denied("Templates are written by team leads and up.");
    const cid = payload.client_id ? str(payload.client_id, 60) : null;
    if (cid) editableOr(user, cid);
    const title = str(payload.title, 80).trim(), text = str(payload.text, 1500).trim();
    if (title.length < 3 || text.length < 8) throw bad("Give the template a short title and the text, a few words at least.");
    const id = payload.id ? str(payload.id, 60) : uuid();
    // Changing a template that is already there needs edit access to the client it belongs to now, as deleting it does.
    const ex = payload.id ? await one(env, "SELECT client_id FROM note_templates WHERE id = ?", id) : null;
    if (ex && ex.client_id) editableOr(user, ex.client_id);
    await run(env, `INSERT INTO note_templates (id, client_id, title, text, by_id, by_name, at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET client_id = excluded.client_id, title = excluded.title, text = excluded.text, by_id = excluded.by_id, by_name = excluded.by_name, at = excluded.at`, id, cid, title, text, user.id, user.name || "", Date.now());
    return { ok: true, id };
  },
  "templates.delete": async ({ env, user, payload }) => {
    if (user.role !== "supervisor" || isSME(user)) throw denied("Templates are managed by team leads and up.");
    const t = await one(env, "SELECT client_id FROM note_templates WHERE id = ?", str(payload.id, 60));
    if (t && t.client_id) editableOr(user, t.client_id);
    await run(env, "DELETE FROM note_templates WHERE id = ?", str(payload.id, 60));
    return { ok: true };
  },
  /* What the team picked most for this payer at this client (last 90 days), so a biller can start from it. */
  "saag.suggest": async ({ env, user, payload }) => {
    const cid = str(payload.client_id, 60), payer = str(payload.payer, 160).trim();
    if (!cid || !inScope(user, cid)) return { rows: [] };
    const since = Date.now() - 90 * 86400000;
    const q = (byPayer) => all(env, `SELECT n.status, n.sub_status, n.action, n.bucket, COUNT(*) AS n FROM notes n JOIN claims c ON c.id = n.claim_id
      WHERE c.client_id = ? AND n.kind = 'work' AND n.created_at > ? AND n.status <> '' AND n.sub_status <> '' AND n.action <> ''${byPayer ? " AND lower(c.payer) = lower(?)" : ""}
      GROUP BY n.status, n.sub_status, n.action ORDER BY n DESC LIMIT 3`, cid, since, ...(byPayer ? [payer] : []));
    let rows = payer ? await q(true) : [];
    const scope = rows.length ? "payer" : "client";
    if (!rows.length) rows = await q(false);
    return { rows, scope };
  },

  /* ---- Ctrl+K: find a claim by number, account or patient, within what this person may open ---- */
  "search.global": async ({ env, user, payload }) => {
    const q = str(payload.q, 80).trim().replace(/[%_\\]/g, "");
    if (q.length < 2) return { claims: [] };
    const like = "%" + q + "%", sup = user.role === "supervisor";
    const rows = await all(env, `SELECT c.id, c.client_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, c.state, c.assigned_to, c.last_worked_by, c.handoff_status,
        cl.name AS client_name, u.name AS assigned_name FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN users u ON u.id = c.assigned_to
      WHERE (c.claim_no LIKE ? OR c.account_no LIKE ? OR c.patient LIKE ?) AND (${sup ? "1 = 1" + scopeSql(user, "c.client_id") : "c.assigned_to = ? OR c.last_worked_by = ?"} OR ${POSTED_CLOSED_SQL})
      ORDER BY CASE WHEN c.claim_no = ? OR c.account_no = ? THEN 0 ELSE 1 END, CASE WHEN c.state IN ('open','assigned','in_progress') THEN 0 ELSE 1 END, c.balance DESC LIMIT 40`,
      like, like, like, ...(sup ? scopeArgs(user) : [user.id, user.id]), q, q);
    const ok = [];
    for (const c of rows) if (ok.length < 8 && (deskOf(user) ? postedClosed(c) || (await canSeeClaim(env, user, c)) : leadFor(user, c.client_id) || c.assigned_to === user.id || c.last_worked_by === user.id || postedClosed(c))) ok.push(c);
    return { claims: ok.map(({ assigned_to, last_worked_by, handoff_status, ...c }) => ({ ...c, posted: handoff_status === "posted" && c.state === "closed" })) };
  },
  /* ---- The bell: what needs this person now, each with the page that deals with it ---- */
  /* Repeat denials on this person's clients: the same claim denied again for the same reason, and the payer and reason seen on
     3 or more claims in 30 days, each with what worked before. */
  "denials.repeats": async ({ env, user, payload }) => {
    const cls = (await all(env, "SELECT id FROM clients WHERE active = 1")).filter((c) => inScope(user, c.id) && (!payload.client_id || c.id === payload.client_id));
    return await repeatDenials(env, cls.map((c) => c.id));
  },
  /* Tips on one claim: payer tips (usual days to payment after the action, what worked for this status, a follow-up date to
     suggest), whether it was denied again for the same reason and what worked, and whether it turns 90 soon. */
  "claims.tips": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT * FROM claims WHERE id = ?", str(payload.id, 60));
    if (!c) throw notFound("Claim not found.");
    if (!(await canViewClaim(env, user, c))) throw denied("This claim is not in your queue.");
    const tips = await payerTips(env, c, { status: str(payload.status, 60).trim(), sub_status: str(payload.sub_status, 160).trim(), action: str(payload.action, 160).trim() });
    if (tips.repeat) tips.repeat.worked = whatWorked(await denialHistory(env, [c.client_id], c.payer || ""))(c.client_id, c.payer || "", tips.repeat.reason);
    const today = isoDate(payload.today) || istISO(Date.now()), d = isoDate(c.dos);
    const age = d ? Math.round((Date.parse(today) - Date.parse(d)) / 86400000) : c.age_days;
    tips.turn90 = age != null && age >= 77 && age <= 90 && !["closed"].includes(c.state) ? { age, days_left: 91 - age } : null;
    return tips;
  },
  /* Past TAT: everything past its TAT on this person's clients, what is due in the next hours, and what is on hold with a reason. */
  "tat.list": async ({ env, user, payload }) => {
    const now = Date.now();
    const cls = (await all(env, "SELECT id, name, posting_tat_hours, submission_tat_hours FROM clients WHERE active = 1 ORDER BY name")).filter((c) => leadFor(user, c.id) && (!payload.client_id || c.id === payload.client_id));
    const board = await tatBoard(env, cls.map((c) => c.id), now);
    const label = (x) => x.group === "desks" ? (TAT_DEPTS.find(([k]) => k === x.dept) || [, x.dept])[1] + (x.recheck ? " · recheck" : "") : "Needs attention · " + (ATTN_PARTS.find(([k]) => k === x.part) || [, x.part])[1];
    const shape = (c, x) => ({ ...x, client_id: c.id, client_name: c.name, type: label(x), tat: x.group === "desks" ? (x.tat != null ? x.tat : tatHours(c, x.dept)) : ATTN_TAT_HOURS, can_hold: canEditClient(user, c.id) });
    const late = [], soon = [], held = [];
    // desk people: their own desk's tasks only (never AR's Needs attention, nor another desk's)
    const dd = deskDepts(user), mine = (x) => !dd || (x.group === "desks" && dd.includes(x.dept));
    for (const c of cls) { const t = board.get(c.id); if (!t) continue; t.late.filter(mine).forEach((x) => late.push(shape(c, x))); t.soon.filter(mine).forEach((x) => soon.push(shape(c, x))); t.held.filter(mine).forEach((x) => held.push(shape(c, x))); }
    late.sort((a, b) => b.over_h - a.over_h); soon.sort((a, b) => a.due - b.due); held.sort((a, b) => a.hold.until.localeCompare(b.hold.until));
    return { late, soon, held, reasons: TAT_HOLD_REASONS, due_soon_hours: DUE_SOON_HOURS, max_days: 30, clients: cls.map((c) => ({ id: c.id, name: c.name })) };
  },
  /* "Can't close yet": the reason and the expected close date. Until that date the task is off the Past TAT reminders. */
  "tat.hold": async ({ env, user, payload }) => {
    const kind = payload.kind === "flag" ? "flag" : "handoff", id = str(payload.id, 60), now = Date.now();
    let clientId, claimId, since = null;
    if (kind === "handoff") {
      const h = await one(env, "SELECT id, client_id, claim_id, status, dept FROM handoffs WHERE id = ?", id);
      if (!h || (deskDepts(user) && !deskDepts(user).includes(h.dept))) throw notFound("That task was not found.");
      if (!["pending", "assigned", "client", "assistance", "back"].includes(h.status)) throw bad("This task is already closed.");
      clientId = h.client_id; claimId = h.claim_id;
    } else {
      const c = await one(env, "SELECT id, client_id, escalated, escalated_at FROM claims WHERE id = ?", id);
      if (!c || deskOf(user)) throw notFound("That claim was not found.");
      if (!c.escalated) throw bad("This claim is no longer flagged for a team lead.");
      clientId = c.client_id; claimId = c.id; since = c.escalated_at;
    }
    editableOr(user, clientId);
    const reason = TAT_HOLD_REASONS.includes(payload.reason) ? payload.reason : "";
    if (!reason) throw bad("Pick why it cannot be closed yet.");
    const note = str(payload.note, 500).trim();
    if (reason === "Other" && note.length < 3) throw bad("Write the reason.");
    const today = istISO(now), until = isoDate(payload.until);
    if (!until || until < today) throw bad("Pick the expected close date: today or later.");
    if (until > istISO(now + 30 * 86400000)) throw bad("The expected close date can be at most 30 days ahead.");
    await env.DB.batch([
      env.DB.prepare("UPDATE tat_holds SET cleared_at = ?, cleared_by_name = ? WHERE kind = ? AND ref_id = ? AND cleared_at IS NULL").bind(now, user.name || "", kind, id),
      env.DB.prepare("INSERT INTO tat_holds (id, kind, ref_id, client_id, claim_id, since, reason, note, until, by_id, by_name, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(uuid(), kind, id, clientId, claimId, since, reason, note, until, user.id, user.name || "", now),
      claimEvent(env, claimId, user, "tat_hold", reason, { until, note, kind }),
    ]);
    return { ok: true, until };
  },
  "tat.unhold": async ({ env, user, payload }) => {
    const h = await one(env, "SELECT * FROM tat_holds WHERE id = ? AND cleared_at IS NULL", str(payload.id, 60));
    const hd = h && deskDepts(user) && h.kind === "handoff" ? await one(env, "SELECT dept FROM handoffs WHERE id = ?", h.ref_id) : null;
    if (!h || (deskDepts(user) && !(hd && deskDepts(user).includes(hd.dept)))) throw notFound("That hold was not found, or it was already cleared.");
    editableOr(user, h.client_id);
    await env.DB.batch([
      env.DB.prepare("UPDATE tat_holds SET cleared_at = ?, cleared_by_name = ? WHERE id = ?").bind(Date.now(), user.name || "", h.id),
      claimEvent(env, h.claim_id, user, "tat_unhold", h.reason, { until: h.until }),
    ]);
    return { ok: true };
  },
  /* The TAT reminder email as this person would get it now (Posting, Submission and Rejections at 09:00; AR at 19:00 IST). */
  "tat.preview": async ({ env, user, payload }) => {
    const kind = payload.kind === "ar" ? "ar" : "desks", now = Date.now();
    const clients = await all(env, "SELECT id, name, posting_tat_hours, submission_tat_hours FROM clients WHERE active = 1 ORDER BY name");
    const board = await tatBoard(env, clients.filter((c) => onClient(user, c.id)).map((c) => c.id), now);
    const tasks = kind === "ar" ? (await lateTeamTasks(env, now)).filter((t) => t.created_by === user.id) : [];
    const mail = tatMailFor(user, kind, clients, board, now, env.APP_URL, tasks);
    const log = await all(env, "SELECT day, kind, at, ok, error, items FROM tat_mail_log WHERE user_id = ? ORDER BY at DESC LIMIT 10", user.id);
    return { kind, hour: TAT_MAIL[kind].hour, mail, log };
  },
  "notify.list": async ({ env, user, payload }) => {
    const items = [], now = Date.now(), today = isoDate(payload.today) || isoToday(), plural = (n, a, b) => n + " " + (n === 1 ? a : b);
    let pastTat = 0;
    let alerts = [];
    const add = (key, tone, n, text, view, params) => { if (n > 0) items.push({ key, tone, n, text, view, params: params || null }); };
    // what was done to this person: made responsible for a client, or taken off one (two weeks)
    for (const n of await all(env, "SELECT id, text, view, client_id, at FROM user_notices WHERE user_id = ? AND at > ? ORDER BY at DESC LIMIT 10", user.id, now - 14 * 86400000))
      items.push({ key: "notice:" + n.id, tone: "info", n: 1, text: n.text, view: n.view, params: n.view === "escalations" && n.client_id ? { client_id: n.client_id } : null, at: n.at });
    const ho = await OPS["handoffs.count"]({ env, user });
    add("handoffs", ho.overdue ? "red" : ho.due_soon ? "amber" : "info", ho.n, plural(ho.n, "posting / submission hand-off", "posting / submission hand-offs") + " on your desk" + (ho.overdue ? `, ${ho.overdue} past the TAT` : ""), "handoffs");
    if (user.role === "supervisor") {
      // past TAT and due soon on this person's clients: every supervisor, SME and above on the client sees them until they are closed
      const tcl = (await all(env, "SELECT id, name, posting_tat_hours, submission_tat_hours FROM clients WHERE active = 1 ORDER BY name")).filter((c) => leadFor(user, c.id));
      const tb = await tatBoard(env, tcl.map((c) => c.id), now);
      for (const c of tcl) {
        const t = tb.get(c.id); if (!t) continue;
        for (const [k, label] of TAT_DEPTS) {
          const b = t.desks[k], what = (n) => `${n} ${label} ${n === 1 ? "claim" : "claims"}`;
          // the oldest one's own TAT (the one its due time came from), not the client's TAT now
          const oldest = t.late.filter((x) => x.group === "desks" && x.dept === k).reduce((m, x) => (!m || x.waited_h > m.waited_h ? x : m), null);
          if (b.late) { items.push({ key: `tat:${c.id}:${k}`, cat: "tat", tone: "red", n: b.late, text: `${what(b.late)} past the TAT · ${c.name}`, sub: `Oldest waiting ${b.oldest_late_h} working hours (TAT ${oldest ? oldest.tat : tatHours(c, k)} h)`, view: "handoffs", params: { client_id: c.id, dept: k } }); pastTat += b.late; }
          if (b.soon) items.push({ key: `soon:${c.id}:${k}`, cat: "desks", tone: "amber", n: b.soon, text: `${what(b.soon)} due in the next ${DUE_SOON_HOURS} hours · ${c.name}`, sub: "Still within TAT", view: "handoffs", params: { client_id: c.id } });
        }
        const a = t.attn;
        if (a.late) {
          const one = { flagged: ["flagged by a biller", "flagged by billers"], back: ["sent back by Posting / Submission", "sent back by Posting / Submission"], requests: ["client request to send", "client requests to send"] };
          const parts = ATTN_PARTS.filter(([p]) => a[p].late).map(([p]) => a[p].late + " " + one[p][a[p].late === 1 ? 0 : 1]);
          items.push({ key: `tat:${c.id}:attn`, cat: "tat", tone: "red", n: a.late, text: `${a.late} Needs attention ${a.late === 1 ? "item" : "items"} past ${ATTN_TAT_HOURS} working hours · ${c.name}`, sub: parts.join(" · ") + ` · oldest ${a.oldest_late_h} working hours`, view: "attention", params: { client_id: c.id, tab: { flagged: "esc", back: "desks", requests: "client" }[(ATTN_PARTS.find(([p]) => a[p].late) || ["flagged"])[0]] } });
          pastTat += a.late;
        }
      }
      // claims denied again for the same reason in the last 14 days, on this person's clients
      if (tcl.length) {
        const rd = { n: new Set((await repeatDenialClaims(env, tcl.map((c) => c.id), now)).filter((r) => r.last_at > now - 14 * 86400000).map((r) => r.claim_id)).size };
        if (rd && rd.n) items.push({ key: "repeat_denials", cat: "attention", tone: "amber", n: rd.n, text: plural(rd.n, "claim was", "claims were") + " denied again for the same reason in the last 14 days", sub: "See what worked before for the same payer and reason", view: "attention", params: { tab: "denials" } });
      }
      const at = await OPS["attention.count"]({ env, user });
      add("escalations", at.overdue ? "red" : "amber", at.escalations, plural(at.escalations, "claim flagged by a biller waits", "claims flagged by billers wait") + " for your answer" + (at.overdue ? `, ${at.overdue} over ${ATTN_TAT_HOURS} working hours` : ""), "attention");
      const ec = await OPS["escalations.count"]({ env, user });
      add("esc_reason", "red", ec.needs_reason, plural(ec.needs_reason, "escalation is", "escalations are") + " open over 24 hours: give the reason and expected close date", "escalations", { status: "reason" });
      add("esc_expected", "amber", ec.past_expected, plural(ec.past_expected, "escalation is", "escalations are") + " past the expected close date", "escalations", { status: "open" });
      add("client_requests", "amber", at.client_to_send, plural(at.client_to_send, "client request", "client requests") + " to send to the client", "attention", { tab: "client" });
      const missed = await missedByClient(env, payload);
      let m = 0; for (const [cid, v] of missed) if (leadFor(user, cid)) m += v.ar + v.posting + v.submission;
      add("missed", "amber", m, plural(m, "missed task", "missed tasks") + " on your clients (allocated or handed off, not worked)", "raci");
      const team = (await visibleUsers(env, user)).filter((u) => u.role === "user" && u.active);
      const outIds = new Set((await all(env, "SELECT user_id FROM attendance WHERE day = ? AND status = 'out'", today)).map((r) => r.user_id));
      const absent = team.filter((u) => outIds.has(u.id));
      if (absent.length) {
        const r = await one(env, `SELECT COUNT(*) AS n FROM claims WHERE state = 'assigned' AND assigned_to IN (${absent.map(() => "?").join(",")})`, ...absent.map((u) => u.id));
        add("absent", "amber", (r && r.n) || 0, plural((r && r.n) || 0, "claim sits", "claims sit") + " on the desks of people out today", "teamtoday");
      }
      const miss = await missingAlerts(env, user);
      add("shastra_missing", "red", miss.alerts.length, (miss.alerts.length === 1 ? miss.alerts[0].name + " has" : miss.alerts.length + " people have") + " not logged in to Shastra an hour after the shift began", "live");
      alerts = miss.alerts;
      const cl = (await OPS["clients.list"]({ env, user })).clients.filter((c) => c.active && c.can_edit && c.profile_gaps.length);
      add("profiles", "amber", cl.length, (cl.length === 1 ? cl[0].name + "'s profile is" : cl.length + " client profiles are") + " incomplete: " + (cl.length === 1 ? cl[0].profile_gaps.slice(0, 3).join(", ") : "scope of work, locations, targets or the people responsible"), "clients");
      const month = closingMonth(today);
      const mine = (await all(env, "SELECT id, name FROM clients WHERE active = 1 ORDER BY name")).filter((c) => leadFor(user, c.id));
      if (mine.length) {
        const done = new Set((await all(env, "SELECT client_id, step FROM client_monthend WHERE month = ? AND done_at IS NOT NULL", month)).map((r) => r.client_id + "\u0001" + r.step));
        const late = []; for (const c of mine) { const n = MONTHEND_STEPS.filter(([k, , due]) => nthWorkingDayAfter(month, due) < today && !done.has(c.id + "\u0001" + k)).length; if (n) late.push({ c, n }); }
        const n = late.reduce((t, x) => t + x.n, 0);
        add("monthend", "amber", n, plural(n, "month-end step", "month-end steps") + ` for ${monthName(month)} past due` + (late.length === 1 ? " at " + late[0].c.name : ` at ${late.length} clients`), "client", late.length ? { client_id: late[0].c.id } : null);
      }
    } else {
      const r = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'assigned' AND (follow_up_on = '' OR follow_up_on IS NULL OR follow_up_on <= ?)", user.id, today);
      add("queue", "info", (r && r.n) || 0, plural((r && r.n) || 0, "claim", "claims") + " on your list for today", "queue");
      const since = now - 3 * 86400000;
      const a = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND escalation_answered_at > ?", user.id, since);
      add("answers", "amber", (a && a.n) || 0, plural((a && a.n) || 0, "escalation was", "escalations were") + " answered by your team lead in the last 3 days", "queue");
      const b = await one(env, "SELECT COUNT(*) AS n FROM handoffs WHERE COALESCE(biller_id, created_by) = ? AND status = 'back' AND dept <> 'subcheck' AND done_at > ?", user.id, since);
      add("back", "amber", (b && b.n) || 0, plural((b && b.n) || 0, "hand-off was", "hand-offs were") + " sent back to you by posting / submission in the last 3 days", "queue");
    }
    // team tasks: given to this person (new, a reminder, past the TAT); for a team lead, the tasks they see (updates on the ones
    // they gave since they last opened them, someone asking for help, the ones past the TAT)
    const todayIst = istISO(now);
    for (const r of await all(env, `SELECT p.id, p.share, p.done_n, p.seen_at, p.reminded_at, t.id AS task_id, t.title, t.due_at, t.hold_until, t.created_by_name, cl.name AS client_name
        FROM team_task_people p JOIN team_tasks t ON t.id = p.task_id LEFT JOIN clients cl ON cl.id = t.client_id WHERE p.user_id = ? AND t.status = 'open' AND p.status <> 'completed' ORDER BY t.due_at LIMIT 50`, user.id)) {
      const held = !!r.hold_until && r.hold_until >= todayIst, sub = `${r.client_name || "Internal"} · ${r.done_n} of ${plural(r.share, "item", "items")} done · due ${istWhen(r.due_at)}`;
      if (!r.seen_at) items.push({ key: "task_new:" + r.id, cat: "tasks", tone: "info", n: 1, text: `New task from ${r.created_by_name}: ${r.title}`, sub, view: "mytasks", params: { id: r.task_id } });
      else if (r.reminded_at && r.reminded_at > r.seen_at) items.push({ key: "task_remind:" + r.id + ":" + r.reminded_at, cat: "tasks", tone: "amber", n: 1, text: `Reminder from ${r.created_by_name}: ${r.title}`, sub, view: "mytasks", params: { id: r.task_id } });
      if (!held && now > r.due_at) items.push({ key: "task_late:" + r.id, cat: "tasks", tone: "red", n: 1, text: `A task is past the TAT: ${r.title}`, sub, view: "mytasks", params: { id: r.task_id } });
    }
    if (user.role === "supervisor") {
      // the open tasks, and the ones everyone completed in the last 3 days (the last update closed them: the team lead still hears of it)
      const seen3 = (await all(env, "SELECT t.id, t.title, t.client_id, t.created_by, t.due_at, t.hold_until, t.lead_seen_at, t.status, cl.name AS client_name FROM team_tasks t LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.status = 'open' OR (t.status = 'done' AND t.closed_at > ?) ORDER BY t.due_at LIMIT 2000", now - 3 * 86400000))
        .filter((t) => taskLeadSees(user, t));
      const lt = seen3.filter((t) => t.status === "open");
      const byId = new Map(seen3.map((t) => [t.id, t]));
      for (const part of chunks(seen3.map((t) => t.id), 80)) {
        const q = part.map(() => "?").join(",");
        // someone asking for help stays on the bell until they update again
        for (const h of await all(env, `SELECT p.id, p.done_n, p.share, p.updated_at, p.task_id, u.name FROM team_task_people p LEFT JOIN users u ON u.id = p.user_id WHERE p.task_id IN (${q}) AND p.status = 'help'`, ...part).then((xs) => xs.filter((x) => byId.get(x.task_id).status === "open"))) {
          const t = byId.get(h.task_id);
          items.push({ key: "task_help:" + h.id + ":" + (h.updated_at || 0), cat: "tasks", tone: "amber", n: 1, text: `${h.name || "Someone"} needs your help on a task`, sub: `${t.title} · ${h.done_n} of ${h.share} done · ${t.client_name || "Internal"}`, view: "attention", params: { tab: "tasks", task: t.id } });
        }
        // the latest update on each task this team lead gave, since they last opened it
        const mineIds = part.filter((id) => byId.get(id).created_by === user.id);
        if (mineIds.length) {
          const last = new Map();
          for (const u of await all(env, `SELECT u.task_id, u.user_name, u.done_n, u.status, u.at, p.share FROM team_task_updates u LEFT JOIN team_task_people p ON p.id = u.person_id WHERE u.task_id IN (${mineIds.map(() => "?").join(",")}) AND u.kind = 'update' ORDER BY u.at`, ...mineIds)) last.set(u.task_id, u);
          for (const id of mineIds) { const t = byId.get(id), u = last.get(id); if (!u || u.status === "help" || (t.lead_seen_at && u.at <= t.lead_seen_at)) continue;
            items.push({ key: "task_upd:" + id + ":" + u.at, cat: "tasks", tone: "info", n: 1, text: `${u.user_name} ${u.status === "completed" ? "completed" : "updated"} a task: ${u.done_n} of ${u.share} done`, sub: `${t.title} · ${t.client_name || "Internal"}${t.status === "done" ? " · everyone has completed: the task is done" : ""}`, view: "attention", params: { tab: "tasks", task: id } }); }
        }
      }
      const lateT = lt.filter((t) => !(t.hold_until && t.hold_until >= todayIst) && now > t.due_at);
      if (lateT.length) items.push({ key: "tasks_late", cat: "tasks", tone: "red", n: lateT.length, text: plural(lateT.length, "team task is", "team tasks are") + " past the TAT", sub: lateT.slice(0, 2).map((t) => t.title).join(" · ") + (lateT.length > 2 ? " …" : ""), view: "attention", params: { tab: "tasks", pick: "late" } });
    }
    const fb = await OPS["feedback.count"]({ env, user });
    add("feedback", "info", fb.n, plural(fb.n, "new feedback item", "new feedback items"), "feedback");
    // new claims given to this person that they have not seen yet (the banner on their screen)
    const allocNew = (await all(env, "SELECT id, text, at FROM user_notices WHERE user_id = ? AND kind = 'alloc' AND seen_at IS NULL AND at > ? ORDER BY at DESC LIMIT 10", user.id, now - 2 * 86400000))
      .map((x) => ({ id: x.id, text: x.text, at: x.at, n: Number((/^(\d+)/.exec(x.text) || [])[1]) || 0 }));
    // the bell's categories: Past TAT first, then Needs attention, Desks, Escalations, Team, Setup; billers get My work and Updates
    const sup = user.role === "supervisor";
    const KEY_CAT = { handoffs: sup ? "desks" : "work", escalations: "attention", client_requests: "attention", esc_reason: "escalations", esc_expected: "escalations", missed: "team", absent: "team",
      shastra_missing: "team", profiles: "setup", monthend: "setup", queue: "work", answers: "work", back: "work", feedback: "updates" };
    const VIEW_CAT = { queue: "work", escalations: "escalations", attention: "attention", handoffs: "desks", clients: "setup", client: "setup", raci: "team", live: "team", teamtoday: "team" };
    for (const x of items) if (!x.cat) x.cat = x.key.startsWith("notice:") ? (sup ? VIEW_CAT[x.view] || "updates" : x.view === "queue" || x.view === "handoffs" ? "work" : "updates") : KEY_CAT[x.key] || "updates";
    return { items, at: now, alerts, alloc_new: allocNew, past_tat: pastTat };
  },

  /* ---- Monday digest: the spans this person can see (all for admins and the VP), who gets each, and when it went ---- */
  "digest.spans": async ({ env, user, payload }) => {
    const cid = payload.client_id ? str(payload.client_id, 60) : "";
    if (cid && !inScope(user, cid)) throw outOfScope();
    const spans = (await digestSpans(env, await digestPeople(env))).filter((s) => (cid ? s.clients.some((c) => c.id === cid) : spanVisible(user, s)));
    const wk = digestWeek(Date.now());
    const out = [];
    for (const s of spans) {
      const runs = await all(env, "SELECT week, at, sent, failed, by_name FROM digest_runs WHERE client_id = ? ORDER BY week DESC LIMIT 4", s.key);
      const fails = runs.length ? await all(env, "SELECT name, error FROM digest_log WHERE client_id = ? AND week = ? AND ok = 0", s.key, runs[0].week) : [];
      out.push({ key: s.key, title: s.title, manager: s.manager, clients: s.clients, runs, fails, visible: spanVisible(user, s),
        recipients: s.recipients.map((u) => ({ id: u.id, name: u.name, designation: u.designation || (u.is_admin ? "Admin" : ""), off: (u.prefs || {}).digest === "off", me: u.id === user.id })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return { spans: out, week: wk, email_ready: !!env.EMAIL_PROVIDER, can_send: !!(user.is_admin || user.access_all), mine_off: ((user.prefs || {}).digest === "off") };
  },
  "digest.preview": async ({ env, user, payload }) => {
    const s = (await digestSpans(env, await digestPeople(env))).find((x) => x.key === str(payload.span, 80));
    if (!s || !spanVisible(user, s)) throw denied("That digest is not one of yours.");
    // the same clients as this person's Monday email: a team lead sees only their own clients of the span
    const su = spanFor(user, s);
    if (!su.clients.length) throw bad("None of this digest's clients are yours.");
    return spanMail(env, su, digestWeek(Date.now()));
  },
  /* The full digest as a landscape dashboard (the email's "Open the full digest" button): every client's card with its SLA
     score, Billable and Assign FTE, AR, escalations and what pulls it down, for this week or one of the 8 before. */
  "digest.dashboard": async ({ env, user, payload }) => {
    const spans = (await digestSpans(env, await digestPeople(env))).filter((x) => spanVisible(user, x));
    if (!spans.length) return { empty: true, spans: [], weeks: [], clients: [], notices: [] };
    const askSpan = str(payload.span, 80), askWeek = str(payload.week, 20), notices = [];
    const s0 = spans.find((x) => x.key === askSpan) || spans[0], s = spanFor(user, s0);
    if (askSpan && s0.key !== askSpan) notices.push(`The digest in the link is not one you can see, or it no longer exists. This is ${s.title}.`);
    const now = digestWeek(Date.now()), weeks = Array.from({ length: 9 }, (_, i) => digestWeek(Date.parse(now.week + "T12:00:00Z") - i * 7 * 86400000)).map((w) => ({ week: w.week, first: w.first, last: w.last }));
    const want = weeks.find((w) => w.week === isoDate(payload.week)) || weeks[0];
    if (askWeek && want.week !== askWeek) notices.push(`The week in the link (${askWeek}) is not one of the last 9 Mondays. This is the week of ${dDay(want.first)}.`);
    const wk = digestWeek(Date.parse(want.week + "T12:00:00Z"));
    const { ds, manager } = await spanData(env, s, wk);
    const R = digestRollup(ds);
    const card = (c) => c ? { score: c.score, band: c.band, period: c.period.label, delta: c.delta, prev: c.prev ? c.prev.label : "", kpi_ok: c.items.filter((i) => i.kind === "KPI" && i.status === "ok").length,
      kpi_n: c.items.filter((i) => i.kind === "KPI" && ["ok", "warn", "miss"].includes(i.status)).length, scopes: c.scopes.filter((x) => x.scored).map((x) => ({ name: x.short || x.name, pct: x.pct, band: x.band })),
      drags: c.drags.slice(0, 5).map((i) => ({ scope: i.scope, name: i.name, shown: i.shown, target: i.target, status: i.status })), more: Math.max(0, c.drags.length - 5),
      strengths: c.strengths.slice(0, 2).map((i) => ({ name: i.name, shown: i.shown })) } : null;
    return { span: { key: s.key, title: s.title }, spans: spans.map((x) => ({ key: x.key, title: x.title })), manager, week: want, weeks, rollup: R, notices,
      clients: digestOrder(ds).map((d) => ({ id: d.client.id, name: d.client.name, health: d.health, tls: d.tls, smes: d.smes, wfm: d.wfm ? { billable: d.wfm.billable, assigned_fte: d.wfm.assigned_fte } : null,
        ar: d.ar, collected: d.collected, worked: d.worked, esc: d.esc ? { ...d.esc, rows: undefined } : null, card: card(d.card), monthend: d.monthend, tat: d.tat || null, tat_line: tatLine(d.tat) })) };
  },
  "digest.sendMe": async ({ env, user, payload }) => {
    const s = (await digestSpans(env, await digestPeople(env))).find((x) => x.key === str(payload.span, 80));
    if (!s || !spanVisible(user, s)) throw denied("That digest is not one of yours.");
    if (!user.email || !/@/.test(user.email)) throw bad("Your account has no email address.");
    const su = spanFor(user, s);
    if (!su.clients.length) throw bad("None of this digest's clients are yours.");
    const m = await spanMail(env, su, digestWeek(Date.now()));
    await sendEmail(env, { to: user.email, subject: "[Copy] " + m.subject, text: m.text, html: m.html });
    return { ok: true, to: user.email };
  },
  /* Admins and the VP: send this week's digest for one span now (only to people who have not had it this week). */
  "digest.sendNow": async ({ env, user, payload }) => {
    if (!user.is_admin && !user.access_all) throw denied("Only an admin or the VP can send the digest by hand.");
    if (!env.EMAIL_PROVIDER) throw new ApiError(503, "Email is not set up on the server yet (EMAIL_PROVIDER).");
    const key = str(payload.span, 80);
    if (!(await digestSpans(env, await digestPeople(env))).some((x) => x.key === key)) throw bad("There is no such digest. Reload the page: the managers or their clients may have changed.");
    const r = await sendDigests(env, { spanKey: key, limit: 1, by: user.name || "by hand" });
    if (!r.spans) throw bad("That digest has no clients now.");
    await audit(env, user, "digest.sendNow", null, `${key} week of ${r.week}: ${r.sent} sent${r.failed ? ", " + r.failed + " failed" : ""}`);
    return r;
  },
  /* ---- Portfolio (VP and managers): every client in one table, worst first, with capacity and data freshness ---- */
  "portfolio.overview": async ({ env, user, payload }) => {
    await snapshotIfStale(env);
    const now = Date.now(), today = isoDate(payload.today) || isoToday();
    const lc = await leadClientIds(env, user, payload.lead_id);
    const clients = (await all(env, "SELECT id, name, code, team_json FROM clients WHERE active = 1 ORDER BY name")).filter((c) => inScope(user, c.id) && (!lc || lc.includes(c.id)) && (!payload.client_id || c.id === payload.client_id));
    const ids = new Set(clients.map((c) => c.id));
    const mapOf = (rows, k = "client_id") => new Map(rows.filter((r) => ids.has(r[k])).map((r) => [r[k], r]));
    const ageSql = "CASE WHEN dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN COALESCE(julianday(?) - julianday(substr(dos, 1, 10)), age_days) ELSE age_days END";
    // over-90 % is of the money owed: credit balances (zero or below) are left out of it
    const ar = mapOf(await all(env, `SELECT client_id, COALESCE(SUM(balance), 0) AS bal, COUNT(*) AS n, COALESCE(SUM(CASE WHEN age > 90 THEN balance ELSE 0 END), 0) AS o90,
        COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS balp, COALESCE(SUM(CASE WHEN age > 90 AND balance > 0 THEN balance ELSE 0 END), 0) AS o90p,
        SUM(CASE WHEN state IN ('open','assigned','in_progress') THEN 1 ELSE 0 END) AS to_work,
        SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) AS open_n, COALESCE(SUM(CASE WHEN state = 'open' THEN balance ELSE 0 END), 0) AS open_bal
      FROM (SELECT client_id, balance, state, ${ageSql} AS age FROM claims WHERE state IN ${WORKABLE}) GROUP BY client_id`, today));
    const ago = mapOf(await all(env, `SELECT s.client_id, s.ar_balance FROM client_snapshots s WHERE s.day = (SELECT MAX(day) FROM client_snapshots WHERE client_id = s.client_id AND day <= ?)`, istISO(now - 30 * 86400000)));
    const sla = mapOf(await all(env, `SELECT m.client_id, m.score, m.month FROM client_monthend m WHERE m.step = 'sla' AND m.score IS NOT NULL AND m.month = (SELECT MAX(month) FROM client_monthend WHERE client_id = m.client_id AND step = 'sla' AND score IS NOT NULL)`));
    const missed = await missedByClient(env, payload);
    const wait = mapOf(await all(env, `SELECT h.client_id, COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS bal, MIN(COALESCE(h.client_sent_at, h.paused_at)) AS first FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.status = 'client' GROUP BY h.client_id`));
    const esc = await trackerEsc(env);
    const tflRows = (await OPS["payers.limits"]({ env, user, payload: { today } })).rows;
    const tfl = new Map(); for (const r of tflRows) { const t = tfl.get(r.client_id) || { soon_n: 0, soon_bal: 0, past_n: 0, past_bal: 0 }; t.soon_n += r.soon_n; t.soon_bal += r.soon_bal; t.past_n += r.past_n; t.past_bal += r.past_bal; tfl.set(r.client_id, t); }
    // capacity: entries a working day over the last 14 days, against the claims still to work (working days: Monday to Friday,
    // Shastra holidays left out, as the TAT clock counts them)
    const since14 = now - 14 * 86400000;
    let wd = 0; for (let t = since14; t < now; t += 86400000) if (isWorkDay(istISO(t))) wd++;
    const pace = mapOf(await all(env, `SELECT c.client_id, COUNT(*) AS n, COUNT(DISTINCT n.user_id) AS people FROM notes n JOIN claims c ON c.id = n.claim_id WHERE n.kind = 'work' AND n.created_at > ? GROUP BY c.client_id`, since14));
    const lastInv = mapOf(await all(env, `SELECT client_id, MAX(uploaded_at) AS at FROM batches WHERE undone_at IS NULL GROUP BY client_id`));
    const monthStart = payload.from_ms != null ? num(payload.from_ms, 0) : Date.parse(today.slice(0, 7) + "-01T00:00:00Z") - IST_MIN * 60000;
    const collTo = payload.to_ms != null ? num(payload.to_ms, now) : now;
    const coll = mapOf(await all(env, `SELECT client_id, COALESCE(SUM(CAST(json_extract(proof_json, '$.amount') AS REAL)), 0) AS amt FROM handoffs WHERE dept = 'posting' AND status = 'complete' AND done_at BETWEEN ? AND ? GROUP BY client_id`, monthStart, collTo));
    const raci = new Map((await OPS["raci.list"]({ env, user, payload })).rows.map((r) => [r.client_id, r]));
    const closing = closingMonth(today), slaDue = nthWorkingDayAfter(closing, 4);
    const drOv = await drishtiOverview(env), drs = drOv.state === "ok" ? drSummary(drOv, clients, today) : new Map();
    if (drs.size) { await drTickMonthEnd(env, drs); for (const [cid, d] of drs) { if (!(d.period && d.period.kind === "month" && d.score != null)) continue; const m = String(d.period.from).slice(0, 7), cur = sla.get(cid);
      if (!cur || cur.month < m) sla.set(cid, { client_id: cid, score: d.score, month: m }); } }
    const rows = clients.map((c) => {
      const a = ar.get(c.id) || { bal: 0, n: 0, o90: 0, to_work: 0 }, w = wait.get(c.id), e = esc.get(c.id), m = missed.get(c.id) || { ar: 0, posting: 0, submission: 0 }, t = tfl.get(c.id) || { soon_n: 0, soon_bal: 0, past_n: 0, past_bal: 0 };
      const pct = a.balp ? Math.round(a.o90p / a.balp * 1000) / 10 : 0;
      const oldest = w && w.first ? Math.floor((now - w.first) / 86400000) : 0;
      const sl = sla.get(c.id) || null, dr = drs.get(c.id) || null;
      const missN = m.ar + m.posting + m.submission;
      const hh = healthOf({ pct, sla: sl, tfl: t, escLate: e ? e.late : 0, waitingN: w ? w.n : 0, oldest, missed: missN });
      const pc = pace.get(c.id), perDay = pc && wd ? pc.n / wd : 0;
      const r = raci.get(c.id);
      return { client_id: c.id, client: c.name, code: c.code, health: hh.health, reasons: hh.reasons.map((x) => x.text), tl: r ? r.a.map((p) => p.name) : [], manager: r ? r.c.map((p) => p.name) : [],
        ar: a.bal, ar_owed: a.balp || 0, o90_owed: a.o90p || 0, claims: a.n, ar_month_ago: ago.get(c.id) ? ago.get(c.id).ar_balance : null, over90_pct: pct, sla: sl ? { score: sl.score, month: sl.month } : null,
        drishti: dr && dr.period && dr.score != null ? { score: dr.score, band: dr.band, delta: dr.delta, label: dr.period.label, kind: dr.period.kind, counts: dr.counts, scopes: dr.scopes, drags: dr.drags } : null,
        missed: missN, waiting: w ? { n: w.n, bal: w.bal, oldest } : null, escalations_late: e ? e.late || 0 : 0, tfl_soon: t.soon_bal, tfl_soon_n: t.soon_n, tfl_past_n: t.past_n,
        to_work: a.to_work || 0, per_day: Math.round(perDay * 10) / 10, people: pc ? pc.people : 0, days_to_clear: perDay ? Math.ceil((a.to_work || 0) / perDay) : null,
        last_inventory: lastInv.get(c.id) ? lastInv.get(c.id).at : null, collected_month: coll.get(c.id) ? coll.get(c.id).amt : 0,
        open_n: a.open_n || 0, open_bal: a.open_bal || 0 };
    });
    const rank = { risk: 0, watch: 1, good: 2 };
    rows.sort((x, y) => rank[x.health] - rank[y.health] || y.reasons.length - x.reasons.length || y.ar - x.ar);
    // data freshness: what would make the numbers wrong
    const fresh = [];
    for (const r of rows) {
      const days = r.last_inventory ? Math.floor((now - r.last_inventory) / 86400000) : null;
      if (days == null) fresh.push({ tone: "amber", client_id: r.client_id, text: `${r.client}: no inventory uploaded yet` });
      else if (days > 7) fresh.push({ tone: days > 14 ? "red" : "amber", client_id: r.client_id, text: `${r.client}: inventory last uploaded ${days} days ago` });
      if ((!r.sla || r.sla.month < closing) && today > slaDue) fresh.push({ tone: "amber", client_id: r.client_id, text: `${r.client}: SLA for ${monthName(closing)} not scored yet (was due ${slaDue})` });
    }
    const sync = await getSetting(env, "shastra_sync", null);
    if (env.SHASTRA_FEED_KEY && sync && sync.ok === false) fresh.unshift({ tone: "red", text: `Roster sync from Purview Shastra failed: ${sync.error || "no answer"}` });
    else if (env.SHASTRA_FEED_KEY && sync && sync.at && now - sync.at > 3 * 3600000) fresh.unshift({ tone: "amber", text: `Roster last synced from Purview Shastra ${Math.round((now - sync.at) / 3600000)} hours ago` });
    const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
    const totAr = sum("ar"), withAgo = rows.filter((r) => r.ar_month_ago != null), totAgo = withAgo.reduce((t, r) => t + r.ar_month_ago, 0), arComparable = withAgo.reduce((t, r) => t + (r.ar || 0), 0), totO90 = sum("o90_owed"), totOwed = sum("ar_owed");
    const slas = rows.filter((r) => r.sla); const drAll = rows.filter((r) => r.drishti), drRows = drAll.filter((r) => r.drishti.kind === "month");
    const drishti = { state: drOv.state, stale: !!drOv.stale, error: drOv.error || "", avg: drRows.length ? Math.round(drRows.reduce((t, r) => t + r.drishti.score, 0) / drRows.length) : null,
      bands: { ok: drRows.filter((r) => r.drishti.band === "ok").length, warn: drRows.filter((r) => r.drishti.band === "warn").length, miss: drRows.filter((r) => r.drishti.band === "miss").length },
      weeks_only: drAll.length - drRows.length, red: drRows.reduce((t, r) => t + r.drishti.counts.miss, 0), red_names: [...new Set(drRows.flatMap((r) => r.drishti.drags.filter((d) => d.status === "miss").map((d) => d.name)))].slice(0, 4), clients_red: drRows.filter((r) => r.drishti.counts.miss > 0).length };
    
    return { rows, freshness: fresh, drishti, totals: { clients: rows.length, ar: totAr, ar_month_ago: totAgo || null, ar_comparable: arComparable, over90_pct: totOwed ? Math.round(totO90 / totOwed * 1000) / 10 : 0,
      sla_avg: slas.length ? Math.round(slas.reduce((t, r) => t + r.sla.score, 0) / slas.length * 10) / 10 : null, collected_month: sum("collected_month"),
      open_bal: sum("open_bal"), open_n: sum("open_n"), tfl_soon: sum("tfl_soon"), tfl_soon_n: sum("tfl_soon_n"),
      waiting_bal: rows.reduce((t, r) => t + (r.waiting ? r.waiting.bal : 0), 0), at_risk: rows.filter((r) => r.health === "risk").length, watch: rows.filter((r) => r.health === "watch").length, missed: sum("missed") },
      target: OVER90_TARGET, working_days: wd };
  },
  /* Inventory status: where every workable claim stands today (one stage each), the age of the AR against the over-90 target,
     the pace to clear, the SLA checks the inventory can answer today, and what to do first to meet the SLA, worked out from the
     claims themselves. The same for one client when client_id is given. Built on portfolio.overview's per-client rows. */
  "inventory.status": async ({ env, user, payload }) => {
    const now = Date.now(), today = isoDate(payload.today) || isoToday();
    const pf = await OPS["portfolio.overview"]({ env, user, payload: { client_id: payload.client_id, lead_id: payload.lead_id, today } });
    const ids = pf.rows.map((r) => r.client_id);
    const inIds = ids.length ? `(${ids.map(() => "?").join(",")})` : "(NULL)";
    const ageSql = "CASE WHEN c.dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN COALESCE(julianday(?) - julianday(substr(c.dos, 1, 10)), c.age_days) ELSE c.age_days END";
    const d7 = istISO(Date.parse(today + "T12:00:00Z") - 7 * 86400000);
    const monthStart = Date.parse(today.slice(0, 7) + "-01T00:00:00Z") - IST_MIN * 60000;
    // One stage per claim: an open hand-off wins (waiting on the client, or at a desk), then the claim's own state and follow-up date.
    const heldSql = (h) => `EXISTS (SELECT 1 FROM tat_holds t WHERE t.kind = 'handoff' AND t.ref_id = ${h}.id AND t.cleared_at IS NULL AND t.until >= ?)`;
    const ho = `(SELECT claim_id, MAX(status = 'client') AS waiting, MIN(CASE WHEN status <> 'client' AND NOT ${heldSql("handoffs")} THEN due_at END) AS due, MIN(CASE WHEN status = 'client' THEN COALESCE(client_sent_at, paused_at, created_at) END) AS since
      FROM handoffs WHERE status IN ('pending','assigned','client') GROUP BY claim_id)`;
    const st = await all(env, `SELECT c.client_id, CASE WHEN h.waiting = 1 THEN 'waiting' WHEN h.claim_id IS NOT NULL THEN 'desk' WHEN c.state = 'open' THEN 'open'
          WHEN c.state IN ('assigned','in_progress') THEN 'list' WHEN c.follow_up_on <> '' AND c.follow_up_on < ? THEN 'overdue' WHEN c.follow_up_on = ? THEN 'due' ELSE 'later' END AS stage,
        COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS bal,
        SUM(c.follow_up_on <> '' AND c.follow_up_on < ?) AS o7, SUM(h.waiting = 1 AND h.since < ?) AS w10, SUM(h.waiting = 0 AND h.due < ?) AS late,
        MIN(CASE WHEN c.state = 'open' THEN c.created_at END) AS first_open, MIN(CASE WHEN c.follow_up_on > ? THEN c.follow_up_on END) AS next_fu, COUNT(DISTINCT c.assigned_to) AS people
      FROM claims c LEFT JOIN ${ho} h ON h.claim_id = c.id
      WHERE c.client_id IN ${inIds} AND (c.state IN ${WORKABLE} OR (c.state = 'in_process' AND h.claim_id IS NOT NULL)) GROUP BY 1, 2`,
      today, today, d7, now - 10 * 86400000, now, today, today, ...ids);
    const ages = await all(env, `SELECT client_id, CASE WHEN age > 90 THEN 4 WHEN age > 60 THEN 3 WHEN age > 30 THEN 2 ELSE 1 END AS b, COUNT(*) AS n, COALESCE(SUM(balance), 0) AS bal, COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS pbal
      FROM (SELECT c.client_id, c.balance, ${ageSql} AS age FROM claims c WHERE c.client_id IN ${inIds} AND c.state IN ${WORKABLE}) GROUP BY 1, 2`, today, ...ids);
    // turning 90 soon: claims that cross into over 90 in the next 7 / 14 days (91 days old is over 90)
    const t90 = await all(env, `SELECT client_id, SUM(CASE WHEN age BETWEEN 84 AND 90 THEN 1 ELSE 0 END) AS n7, COALESCE(SUM(CASE WHEN age BETWEEN 84 AND 90 THEN balance END), 0) AS bal7,
        SUM(CASE WHEN age BETWEEN 77 AND 90 THEN 1 ELSE 0 END) AS n14, COALESCE(SUM(CASE WHEN age BETWEEN 77 AND 90 THEN balance END), 0) AS bal14
      FROM (SELECT c.client_id, c.balance, ${ageSql} AS age FROM claims c WHERE c.client_id IN ${inIds} AND c.state IN ${WORKABLE} AND c.balance > 0) GROUP BY client_id`, today, ...ids);
    const big = await all(env, `SELECT client_id, balance, payer FROM (SELECT client_id, balance, payer, ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY balance DESC) AS rn
        FROM (SELECT c.client_id, c.balance, c.payer, ${ageSql} AS age FROM claims c WHERE c.client_id IN ${inIds} AND c.state IN ${WORKABLE}) WHERE age > 90 AND balance > 0)
      WHERE rn <= 3000 ORDER BY balance DESC`, today, ...ids);
    const holders = await all(env, `SELECT c.client_id, c.assigned_to, u.name, COUNT(*) AS n FROM claims c LEFT JOIN users u ON u.id = c.assigned_to
      WHERE c.client_id IN ${inIds} AND c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on < ? AND c.assigned_to IS NOT NULL AND ${INV_NO_OPEN_HO} GROUP BY 1, 2`, ...ids, today);
    // closed this month: by when it was closed (a note added later does not count it again)
    const closed = await all(env, `SELECT client_id, COUNT(*) AS n, COALESCE(SUM(balance), 0) AS bal FROM claims WHERE client_id IN ${inIds} AND state = 'closed' AND COALESCE(closed_at, updated_at) >= ? GROUP BY 1`, ...ids, monthStart);
    // the desk tasks the scorecard's TAT counts (Payment posting, Submission, Rejections), past the client's TAT and not on hold;
    // waiting on the client too (the clock keeps running). The recheck after submitting is not one: it has its own reminders.
    const deskLate = await all(env, `SELECT h.client_id, h.dept, COUNT(*) AS n FROM handoffs h WHERE h.client_id IN ${inIds} AND h.dept IN ('posting','submission','rejection') AND h.status IN ('pending','assigned','client') AND h.due_at < ? AND NOT ${heldSql("h")} GROUP BY 1, 2`, ...ids, now, today);
    const escOpen = await all(env, `SELECT client_id, SUM(CASE WHEN kind = 'internal' THEN 0 ELSE 1 END) AS n, SUM(CASE WHEN kind = 'internal' THEN 1 ELSE 0 END) AS ni FROM escalations WHERE client_id IN ${inIds} AND status <> 'resolved' GROUP BY 1`, ...ids);
    // working days left in the month, today included (Monday to Friday)
    let wdLeft = 0; { const [y, m] = today.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let dd = Number(today.slice(8, 10)); dd <= last; dd++) if (isWorkDay(`${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`)) wdLeft++; }
    const STAGES = ["open", "list", "later", "due", "overdue", "waiting", "desk"];
    const blank = () => ({ stages: Object.fromEntries(STAGES.map((k) => [k, { n: 0, bal: 0 }])), o7: 0, w10: 0, late: 0, first_open: null, next_fu: null, list_people: 0,
      ages: [1, 2, 3, 4].map(() => ({ n: 0, bal: 0, pbal: 0 })), big: [], holders: [], closed: { n: 0, bal: 0 }, desk_late: {}, esc_open: 0, esc_int_open: 0, t90: { n7: 0, bal7: 0, n14: 0, bal14: 0 } });
    const per = new Map(ids.map((id) => [id, blank()])), tot = blank();
    const both = (cid, fn) => { const p = per.get(cid); if (p) { fn(p); fn(tot); } };
    for (const r of st) both(r.client_id, (x) => { const s = x.stages[r.stage]; s.n += r.n; s.bal += r.bal; if (r.stage === "overdue") x.o7 += r.o7 || 0; if (r.stage === "waiting") x.w10 += r.w10 || 0; if (r.stage === "desk") x.late += r.late || 0;
      if (r.first_open && (!x.first_open || r.first_open < x.first_open)) x.first_open = r.first_open; if (r.stage === "later" && r.next_fu && (!x.next_fu || r.next_fu < x.next_fu)) x.next_fu = r.next_fu; if (r.stage === "list") x.list_people += r.people; });
    for (const r of ages) both(r.client_id, (x) => { x.ages[r.b - 1].n += r.n; x.ages[r.b - 1].bal += r.bal; x.ages[r.b - 1].pbal += r.pbal; });
    for (const r of big) both(r.client_id, (x) => x.big.push(r));
    for (const r of holders) both(r.client_id, (x) => { const h = x.holders.find((y) => y.id === r.assigned_to); if (h) h.n += r.n; else x.holders.push({ id: r.assigned_to, name: r.name || "someone", n: r.n }); });
    for (const r of closed) both(r.client_id, (x) => { x.closed.n += r.n; x.closed.bal += r.bal; });
    for (const r of deskLate) both(r.client_id, (x) => { x.desk_late[r.dept] = (x.desk_late[r.dept] || 0) + r.n; });
    for (const r of escOpen) both(r.client_id, (x) => { x.esc_open += r.n || 0; x.esc_int_open += r.ni || 0; });
    for (const r of t90) both(r.client_id, (x) => { for (const f of ["n7", "bal7", "n14", "bal14"]) x.t90[f] += Number(r[f]) || 0; });
    const pfBy = new Map(pf.rows.map((r) => [r.client_id, r]));
    const T = OVER90_TARGET;
    const money = (v) => { const a = Math.abs(v || 0); return "$" + (a >= 1e6 ? (Math.round(a / 1e4) / 100) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "k" : a >= 1e3 ? (Math.round(a / 100) / 10) + "k" : Math.round(a)); };
    const pl = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const deptName = { posting: "Posting", submission: "Submission", subcheck: "Submission", rejection: "Rejections" };
    // What to do first, most SLA-damaging first. Each card: the number, why it matters, and the one action.
    const insights = (x, cl, cid) => {
      // the over-90 share is of the money owed: credit balances are left out of it
      const out = [], arTot = x.ages.reduce((t, a) => t + a.pbal, 0), o90 = x.ages[3].pbal, pct = arTot ? Math.round(o90 / arTot * 1000) / 10 : 0;
      const at = (k) => x.stages[k], params = cid ? { clientId: cid } : {};
      if (pct > T) {
        const need = (o90 - T / 100 * arTot) / (1 - T / 100); let n = 0, s = 0; const pay = {};
        for (const b of x.big) { if (s >= need) break; n++; s += b.balance; pay[b.payer || "no payer"] = (pay[b.payer || "no payer"] || 0) + 1; }
        const top = Object.entries(pay).sort((a, b) => b[1] - a[1]).slice(0, 2);
        const after = arTot - s > 0 ? Math.round((o90 - s) / (arTot - s) * 1000) / 10 : 0, under = s >= need;
        if (n) out.push({ tone: "red", num: money(s), sub: pl(n, "claim") + " · over 90 days", short: `Resolve the ${pl(n, "biggest claim")} over 90 days (${money(s)})`, title: `Over-90 AR is ${pct}%, target ≤ ${T}%.`,
          text: `Resolve the ${n === 1 ? "biggest claim" : n + " biggest claims"} over 90 days and it comes ${under ? "under " + T + "%" : "down to " + after + "%"}.` + (top.length ? ` Most are with ${top.map(([p, k]) => p + " (" + k + ")").join(" and ")}.` : ""),
          act: [{ label: "Open the list", to: "claims", params: { ...params, min_age: 91, sort: "balance", dir: "desc", state: "workable" } }] });
      }
      if (x.t90.n7) {
        const next = arTot ? Math.round((o90 + x.t90.bal7) / arTot * 1000) / 10 : 0;
        out.push({ tone: next > T ? "red" : "amber", num: money(x.t90.bal7), sub: pl(x.t90.n7, "claim") + " · turn 90 in 7 days", short: `Work the ${pl(x.t90.n7, "claim")} turning 90 this week (${money(x.t90.bal7)})`,
          title: "Turning 90 in the next 7 days.", text: `If they are not resolved, over 90 goes from ${pct}% to ${next}% next week${next > T && pct <= T ? `, past the ${T}% target` : ""}. They are already moved up the billers' lists` + (x.t90.n14 > x.t90.n7 ? `; ${x.t90.n14 - x.t90.n7} more turn 90 the week after.` : "."),
          act: [{ label: "Open the list", to: "claims", params: { ...params, turning90: 7, sort: "balance", dir: "desc", state: "workable" } }] });
      }
      if (at("overdue").n) {
        const hs = x.holders.sort((a, b) => b.n - a.n).slice(0, 3);
        out.push({ tone: x.o7 ? "red" : "amber", short: pl(at("overdue").n, "overdue follow-up"), num: String(at("overdue").n), sub: "overdue follow-ups · " + money(at("overdue").bal), title: "Follow-up dates have passed and nobody has worked the claim since.",
          text: (x.o7 ? `${x.o7} are over 7 days late. ` : "") + (hs.length ? `Most are with ${hs.map((h) => h.name + " (" + h.n + ")").join(", ")}.` : "") + " Overdue follow-ups keep Days in AR and the over-90 bucket up.",
          act: [{ label: "Open them", to: "claims", params: { ...params, stage: "overdue", state: "" } }] });
      }
      const tf = cl ? { n: cl.tfl_soon_n, bal: cl.tfl_soon, past: cl.tfl_past_n } : pf.rows.reduce((a, r) => ({ n: a.n + r.tfl_soon_n, bal: a.bal + r.tfl_soon, past: a.past + r.tfl_past_n }), { n: 0, bal: 0, past: 0 });
      if (tf.n) out.push({ tone: "amber", short: pl(tf.n, "claim") + " near timely filing", num: String(tf.n), sub: "claims · " + money(tf.bal) + " · timely filing", title: "Timely filing limit in the next 30 days.", text: "Lose these and the money cannot be collected. Work them before anything else on the list." + (tf.past ? ` ${tf.past} are already past the limit.` : ""),
        act: [{ label: "Open the insurance limits", to: "limits", params: {} }] });
      if (at("waiting").n) out.push({ tone: x.w10 ? "amber" : "blue", short: x.w10 ? `Chase the client: ${x.w10} waiting over 10 days` : pl(at("waiting").n, "claim") + " waiting on the client", num: String(at("waiting").n), sub: "waiting on the client · " + money(at("waiting").bal), title: x.w10 ? `${x.w10} ${x.w10 === 1 ? "has" : "have"} waited on the client more than 10 days.` : "Waiting on the client.",
        text: "Days in AR keeps counting while they wait. Chase the client for the answers.", act: [{ label: "Open Client requests", to: "attention", params: cid ? { tab: "client", client_id: cid } : { tab: "client" } }] });
      if (at("open").n) { const days = x.first_open ? Math.floor((now - x.first_open) / 86400000) : 0;
        out.push({ tone: days > 2 ? "amber" : "blue", short: "Allocate " + pl(at("open").n, "unassigned claim"), num: String(at("open").n), sub: "unassigned · " + money(at("open").bal), title: days > 0 ? `Not handed out yet, the oldest for ${pl(days, "day")}.` : "Not handed out yet.",
          text: "Nobody works a claim that is not on a list. Hand them out so the team's pace covers them.", act: [{ label: "Allocate", to: "allocate", params }] }); }
      const deskLateN = Object.values(x.desk_late).reduce((t, n) => t + n, 0);
      if (deskLateN) { const by = Object.entries(x.desk_late).map(([k, n]) => n + " at " + (deptName[k] || k)).join(", ");
        // only the TATs these tasks count against: Payment posting's own, and Submission's (Rejections resubmit to it)
        const against = [x.desk_late.posting ? "the Posting TAT" : "", x.desk_late.submission || x.desk_late.rejection ? "the Submission TAT" : ""].filter(Boolean).join(" and ");
        out.push({ tone: "amber", short: pl(deskLateN, "desk task") + " past the TAT", num: String(deskLateN), sub: "desk tasks past the TAT", title: "At Posting, Submission or Rejections past the client's TAT.", text: by + ". " + (deskLateN === 1 ? "It counts" : "These count") + " against " + against + " on the scorecard.", act: [{ label: "Open the desks", to: "handoffs", params: cid ? { client_id: cid } : {} }] }); }
      if (x.esc_open) out.push({ tone: "red", short: "Close " + pl(x.esc_open, "open escalation"), num: String(x.esc_open), sub: "open escalations", title: "Escalations are open. The SLA threshold is 0.", text: "Close them, or give the reason and expected date on the tracker.", act: [{ label: "Open the Escalation tracker", to: "escalations", params: cid ? { client_id: cid } : {} }] });
      // what is fine, so the list is not all alarms
      if (arTot && pct <= T) out.push({ tone: "green", num: pct + "%", sub: `over 90 days · target ≤ ${T}%`, title: "Over-90 AR is within target.", text: x.ages[2].bal ? `Keep it there: ${money(x.ages[2].bal)} is 61 to 90 days old and turns 90+ within the month if not worked.` : "Keep the follow-ups on time to hold it there.", act: [] });
      if (!at("overdue").n && (at("later").n || at("due").n)) out.push({ tone: "green", num: "0", sub: "overdue follow-ups", title: "Every follow-up is on time.", text: at("due").n ? `${at("due").n} are due today.` : "Nothing is due today.", act: [] });
      if (!x.esc_open && !deskLateN && arTot) out.push({ tone: "green", num: "0", sub: "open escalations · desks late", title: "No open escalations and every desk is within TAT.", text: "", act: [] });
      const rank = { red: 0, amber: 1, blue: 2, green: 3 };
      return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
    };
    // one person on several clients counts once in the all-clients view
    const distinct = ids.length > 1 ? await one(env, `SELECT (SELECT COUNT(DISTINCT assigned_to) FROM claims WHERE client_id IN ${inIds} AND state IN ('assigned','in_progress') AND assigned_to IS NOT NULL) AS list_people,
        (SELECT COUNT(DISTINCT n.user_id) FROM notes n JOIN claims c ON c.id = n.claim_id WHERE n.kind = 'work' AND n.created_at > ? AND c.client_id IN ${inIds}) AS pace_people`, ...ids, now - 14 * 86400000, ...ids) : null;
    if (distinct) tot.list_people = distinct.list_people || 0;
    const pace = (rows) => { const tw = rows.reduce((t, r) => t + (r.to_work || 0), 0), pd = rows.reduce((t, r) => t + (r.per_day || 0), 0);
      return { to_work: tw, per_day: Math.round(pd * 10) / 10, people: rows.length > 1 && distinct ? distinct.pace_people || 0 : rows.reduce((t, r) => t + (r.people || 0), 0), days_to_clear: pd ? Math.ceil(tw / pd) : null, wd_left: wdLeft }; };
    const shape = (x, rows, cl, cid) => {
      const arTot = x.ages.reduce((t, a) => t + a.bal, 0), owed = x.ages.reduce((t, a) => t + a.pbal, 0), o90p = x.ages[3].pbal, pc = pace(rows);
      return { stages: x.stages, o7: x.o7, w10: x.w10, late: x.late, oldest_open: x.first_open ? Math.floor((now - x.first_open) / 86400000) : null, next_fu: x.next_fu, list_people: x.list_people,
        ages: x.ages, ar: arTot, over90_pct: owed ? Math.round(o90p / owed * 1000) / 10 : 0, closed: x.closed, esc_open: x.esc_open, esc_int_open: x.esc_int_open, pace: pc,
        checks: [
          { key: "o90", name: "AR over 90 days", now: (owed ? Math.round(o90p / owed * 1000) / 10 : 0) + "%", target: "≤ " + T + "%", ok: !owed || Math.round(o90p / owed * 1000) / 10 <= T },
          { key: "t90", name: "Turning 90 in the next 7 days", now: String(x.t90.n7), target: "worked first", ok: !x.t90.n7, warn: true },
          { key: "fu", name: "Follow-ups overdue", now: String(x.stages.overdue.n), target: "0", ok: !x.stages.overdue.n, warn: x.stages.overdue.n && !x.o7 },
          { key: "tfl", name: "Timely filing in the next 30 days", now: String(cl ? cl.tfl_soon_n : rows.reduce((t, r) => t + r.tfl_soon_n, 0)), target: "0", ok: !(cl ? cl.tfl_soon_n : rows.reduce((t, r) => t + r.tfl_soon_n, 0)), warn: true },
          { key: "desk", name: "Desks past the client's TAT", now: String(Object.values(x.desk_late).reduce((t, n) => t + n, 0)), target: "0", ok: !Object.values(x.desk_late).reduce((t, n) => t + n, 0) },
          { key: "esc", name: "Escalations open · external", now: String(x.esc_open), target: "0", ok: !x.esc_open },
          { key: "esc_int", name: "Escalations open · internal", now: String(x.esc_int_open), target: "0", ok: !x.esc_int_open, warn: true },
          { key: "pace", name: "Days to clear at this pace", now: !pc.to_work ? "nothing to clear" : pc.days_to_clear == null ? "–" : pl(pc.days_to_clear, "day"), target: wdLeft ? "≤ " + pl(wdLeft, "day") + " left" : "no working days left this month", ok: !pc.to_work || (pc.days_to_clear != null && pc.days_to_clear <= wdLeft), warn: pc.days_to_clear == null },
        ],
        insights: insights(x, cl, cid) };
    };
    const clients = pf.rows.map((r) => { const x = per.get(r.client_id), s = shape(x, [r], r, r.client_id);
      return { client_id: r.client_id, client: r.client, health: r.health, tl: r.tl, manager: r.manager, drishti: r.drishti ? { score: r.drishti.score, band: r.drishti.band } : null,
        stages: s.stages, ar: s.ar, over90_pct: s.over90_pct, overdue: s.stages.overdue.n, waiting: s.stages.waiting.n, days_to_clear: s.pace.days_to_clear, per_day: s.pace.per_day,
        do_first: s.insights.filter((i) => i.tone !== "green").slice(0, 2).map((i) => i.short) }; });
    // pending with the desks and team leads, against each TAT (working hours)
    const tb = await tatBoard(env, ids), tcl = payload.client_id ? await one(env, "SELECT posting_tat_hours, submission_tat_hours FROM clients WHERE id = ?", payload.client_id) : null;
    const hol = await getSetting(env, "holidays", null), hrows = hol && Array.isArray(hol.rows) ? hol.rows : [];
    const pending = { ...sumTat([...tb.values()]), tat: { posting: tcl ? tatHours(tcl, "posting") : null, submission: tcl ? tatHours(tcl, "submission") : null, attention: ATTN_TAT_HOURS }, due_soon_hours: DUE_SOON_HOURS,
      holidays: { ok: !!(hol && hol.ok), next: hrows.filter((h) => h.date >= today).slice(0, 3) } };
    for (const c of clients) { const t = tb.get(c.client_id); c.past_tat = t ? t.late.length : 0; }
    return { today, wd_left: wdLeft, target: T, clients, pending, last_inventory: pf.rows.reduce((m, r) => Math.max(m, r.last_inventory || 0), 0) || null,
      drishti: pf.drishti, ...shape(tot, pf.rows, payload.client_id ? pfBy.get(payload.client_id) : null, payload.client_id || "") };
  },
  /* Managers side by side: their clients, their people's work, missed tasks, SLA. The VP and admins see every
     manager; a manager sees their own line. */
  "portfolio.managers": async ({ env, user, payload }) => {
    const now = Date.now(), from = num(payload.from_ms, now - 30 * 86400000), to = num(payload.to_ms, now);
    const users = await all(env, "SELECT id, name, reports_to, roster_kind, scope_projects_json, active FROM users WHERE active = 1");
    const managers = users.filter((u) => u.roster_kind === "manager" && (user.is_admin || user.access_all || u.id === user.id));
    const clients = await all(env, "SELECT id, name, roster_names_json FROM clients WHERE active = 1");
    const kids = new Map(); for (const u of users) if (u.reports_to) { if (!kids.has(u.reports_to)) kids.set(u.reports_to, []); kids.get(u.reports_to).push(u.id); }
    const below = (id) => { const out = new Set(), walk = (x) => (kids.get(x) || []).forEach((k) => { if (!out.has(k)) { out.add(k); walk(k); } }); walk(id); return out; };
    const work = new Map((await all(env, "SELECT user_id, COUNT(*) AS n FROM notes WHERE kind = 'work' AND created_at BETWEEN ? AND ? GROUP BY user_id", from, to)).map((r) => [r.user_id, r.n]));
    const skips = new Map((await all(env, "SELECT user_id, COUNT(*) AS n FROM notes WHERE kind = 'skip' AND created_at BETWEEN ? AND ? GROUP BY user_id", from, to)).map((r) => [r.user_id, r.n]));
    const missed = await missedByClient(env, payload);
    const sla = new Map((await all(env, `SELECT m.client_id, m.score FROM client_monthend m WHERE m.step = 'sla' AND m.score IS NOT NULL AND m.month = (SELECT MAX(month) FROM client_monthend WHERE client_id = m.client_id AND step = 'sla' AND score IS NOT NULL)`)).map((r) => [r.client_id, r.score]));
    const escT = await trackerEsc(env), esc = new Map([...escT].map(([k, v]) => [k, v.late]));
    const rows = managers.map((m) => {
      const names = new Set(jsonList(m.scope_projects_json).map(projKey));
      const mine = clients.filter((c) => jsonList(c.roster_names_json).some((n) => names.has(projKey(n))));
      const team = below(m.id);
      let entries = 0, sk = 0; team.forEach((id) => { entries += work.get(id) || 0; sk += skips.get(id) || 0; });
      const scores = mine.map((c) => sla.get(c.id)).filter((x) => x != null);
      return { id: m.id, name: m.name, clients: mine.map((c) => c.name), people: team.size, entries, skips: sk,
        missed: mine.reduce((t, c) => { const x = missed.get(c.id); return t + (x ? x.ar + x.posting + x.submission : 0); }, 0),
        escalations_late: mine.reduce((t, c) => t + (esc.get(c.id) || 0), 0), sla_avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { rows };
  },
  /* Audit trail: who changed access, RACI, feedback recipients, client settings, month-end. Admins and the VP. */
  "audit.list": async ({ env, user, payload }) => {
    if (!user.is_admin && !user.access_all) throw denied("The audit trail is for admins and the VP.");
    const where = [], args = [];
    if (payload.client_id) { where.push("a.client_id = ?"); args.push(str(payload.client_id, 60)); }
    if (payload.action) { where.push("a.action LIKE ?"); args.push(str(payload.action, 40) + "%"); }
    if (payload.from_ms) { where.push("a.at >= ?"); args.push(num(payload.from_ms, 0)); }
    const rows = await all(env, `SELECT a.*, c.name AS client_name FROM audit_log a LEFT JOIN clients c ON c.id = a.client_id${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY a.at DESC LIMIT 500`, ...args);
    return { rows };
  },

  /* ---- Client 360 › Client report: Sasha's Third Eye's client report pages, from Brahmastra's own data ---- */
  /* Everything one report period needs, as records the page works on: the inventory at the period end and at the end of the
     period before (live, a kept snapshot, or rebuilt from the claims' history), AR work entries, Payment posting, Submission and
     Rejections hand-offs, requests waiting on the client, a six-month trend, what the client is asked for now, and the edits. */
  "creport.get": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (!clientId) throw bad("Pick the client.");
    if (user.role !== "supervisor") throw denied("The Client 360 report is for team leads and above.");
    if (!inScope(user, clientId)) throw outOfScope();
    const client = await one(env, "SELECT id, name, logo FROM clients WHERE id = ?", clientId);
    if (!client) throw bad("Unknown client.");
    const loc = payload.location_id ? str(payload.location_id, 60) : "";
    const from = isoDate(payload.from), to = isoDate(payload.to), pfrom = isoDate(payload.prev_from) || from, pto = isoDate(payload.prev_to) || from;
    if (!from || !to || from > to || pfrom > pto) throw bad("Pick the report period.");
    if ((Date.parse(to) - Date.parse(pfrom)) / 86400000 > 800) throw bad("Pick a shorter period.");
    const periodKey = /^(month|week|custom):[0-9:-]{7,40}$/.test(String(payload.period_key || "")) ? payload.period_key : "custom:" + from + ":" + to;
    await snapshotIfStale(env);
    const now = Date.now(), today = istISO(now);
    const t0 = (d) => Date.parse(d + "T00:00:00Z") - IST_MIN * 60000, t1 = (d) => t0(d) + 86400000 - 1;
    const lw = loc ? " AND c.location_id = ?" : "", la = loc ? [loc] : [];
    const A = t0(pfrom), B = t1(to);
    const label = (s) => String(s || "");
    const [invNow, invPrev, notes, posts, subs, rejs, reqs] = await Promise.all([
      crInventory(env, clientId, loc, to, today), crInventory(env, clientId, loc, pto, today),
      all(env, `SELECT n.claim_id, n.user_name, n.created_at, COALESCE(NULLIF(n.status, ''), n.status_code) AS st, n.sub_status AS sub, n.action AS act, n.bucket AS mv,
          c.claim_no, c.account_no, c.dos, c.age_days, c.payer, c.balance, c.billed, COALESCE(c.location_id, '') AS loc
        FROM notes n JOIN claims c ON c.id = n.claim_id WHERE n.kind = 'work' AND c.client_id = ? AND n.created_at BETWEEN ? AND ?${lw} ORDER BY n.created_at LIMIT 60000`, clientId, A, B, ...la),
      all(env, `SELECT h.claim_id, h.status, h.created_at, h.done_at, h.done_by_name, h.proof_json, c.claim_no, c.account_no, c.dos, c.payer, c.billed, COALESCE(c.location_id, '') AS loc
        FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.dept = 'posting' AND h.client_id = ?${lw}
          AND ((h.status = 'complete' AND h.done_at BETWEEN ? AND ?) OR (h.status <> 'complete' AND h.created_at BETWEEN ? AND ?)) LIMIT 60000`, clientId, ...la, A, B, A, B),
      all(env, `SELECT h.claim_id, h.status, h.created_at, h.done_at, h.done_by_name, h.proof_json, h.reason, h.note, c.claim_no, c.account_no, c.dos, c.payer, c.billed, COALESCE(c.location_id, '') AS loc
        FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.dept = 'submission' AND h.client_id = ?${lw}
          AND ((h.status = 'complete' AND h.done_at BETWEEN ? AND ?) OR (h.status <> 'complete' AND h.created_at BETWEEN ? AND ?)) LIMIT 60000`, clientId, ...la, A, B, A, B),
      all(env, `SELECT h.claim_id, h.status, h.created_at, h.done_at, h.done_by_name, h.proof_json, h.reason, c.claim_no, c.account_no, c.dos, c.payer, c.billed, c.balance, COALESCE(c.location_id, '') AS loc
        FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.dept = 'rejection' AND h.client_id = ? AND h.created_at BETWEEN ? AND ?${lw} LIMIT 60000`, clientId, A, B, ...la),
      // every request that overlaps the two periods: asked by the end, and still waiting or answered (or done) after the start, however long ago it was asked
      all(env, `SELECT h.claim_id, h.dept, h.status, h.reason, h.note, h.paused_at, h.client_sent_at, h.client_answered_at, h.done_at, h.chase_at, c.claim_no, c.account_no, c.dos, c.age_days, c.payer, c.balance, COALESCE(c.location_id, '') AS loc
        FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.client_id = ? AND h.paused_at IS NOT NULL AND h.paused_at <= ?
          AND (h.status = 'client' OR COALESCE(h.client_answered_at, h.done_at, h.paused_at) >= ?)${lw} LIMIT 20000`, clientId, B, A, ...la),
    ]);
    const no = (r) => r.claim_no || r.account_no || "";
    const HO_STATE = { complete: "Done", pending: "Pending", assigned: "Being worked", client: "Waiting on the client", back: "Back with AR", assistance: "Back with AR", rejected: "Sent back" };
    const weekOf = (d) => { const x = new Date(d + "T12:00:00Z"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()] + " week " + Math.ceil(x.getUTCDate() / 7); };
    const data = {
      inventory: invNow, inventoryPrev: invPrev, movement: await crMovement(env, clientId, loc, t1(pto), Math.min(t1(to), now)),
      worked: notes.map((n) => { const wd = istISO(n.created_at); return { id: n.claim_id, no: no(n), dos: n.dos || "", py: label(n.payer), chg: n.billed == null ? null : Number(n.billed), amt: Number(n.balance) || 0,
        bk: crBucket(crAge(n.dos, n.age_days, wd)), st: label(n.st), sub: label(n.sub), act: label(n.act), mv: label(n.mv), wd, by: label(n.user_name), loc: n.loc }; }),
      payment: posts.map((h) => { const pr = jsonObj(h.proof_json), done = h.status === "complete", d = istISO(done ? h.done_at : h.created_at);
        return { id: h.claim_id, no: no(h), dos: h.dos || "", py: label(h.payer), chg: h.billed == null ? null : Number(h.billed), paid: done && pr.amount != null && pr.amount !== "" ? Number(pr.amount) : null,
          chk: done ? str(pr.ref, 80) : "", pd: done ? (isoDate(pr.date) || d) : "", d, wk: weekOf(d), st: done ? "Posted" : HO_STATE[h.status] || "Pending", by: label(h.done_by_name), loc: h.loc }; }),
      submission: subs.map((h) => { const pr = jsonObj(h.proof_json), done = h.status === "complete";
        return { id: h.claim_id, no: no(h), dos: h.dos || "", py: label(h.payer), chg: h.billed == null ? null : Number(h.billed), ok: done, st: done ? "Submitted" : (h.reason || HO_STATE[h.status] || "Pending"),
          cm: done ? "" : [h.reason, h.note].filter(Boolean).join(": "), mode: done ? str(pr.mode, 60) : "", sd: istISO(done ? h.done_at : h.created_at), by: label(h.done_by_name), loc: h.loc }; }),
      rejection: rejs.map((h) => { const pr = jsonObj(h.proof_json);
        return { id: h.claim_id, no: no(h), dos: h.dos || "", py: label(h.payer), chg: h.billed == null ? null : Number(h.billed), amt: Number(h.balance) || 0, st: str(pr.code, 120) || h.reason || "Not coded yet",
          act: h.status === "complete" ? "Corrected and resubmitted" : HO_STATE[h.status] || "Pending", wd: istISO(h.created_at), by: label(h.done_by_name), loc: h.loc }; }),
      // a request still waiting is aged to today (or the period end); an answered one to the day it was answered
      clientAssistance: reqs.map((h) => ({ id: h.claim_id, no: no(h), dos: h.dos || "", py: label(h.payer), amt: Number(h.balance) || 0,
        bk: crBucket(crAge(h.dos, h.age_days, h.status === "client" ? (to < today ? to : today) : istISO(h.client_answered_at || h.done_at || h.paused_at || now))),
        ed: h.status === "client" ? "" : istISO(h.client_answered_at || h.done_at || h.paused_at || now),
        st: h.reason || "Information from the client", act: h.status !== "client" ? "Answered" : h.client_sent_at ? (h.chase_at && now >= h.chase_at ? "Sent, chase now" : "Sent to the client") : "To send to the client",
        wd: istISO(h.paused_at), open: h.status === "client", dept: DEPT_LABEL[h.dept] || h.dept, cm: h.note || "", loc: h.loc })),
    };
    // six months to the period's month: AR at each month end, and what was posted in the month
    const months = []; { const d = new Date(to.slice(0, 7) + "-15T12:00:00Z"); for (let i = 5; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(x.toISOString().slice(0, 7)); } }
    const mEnd = (m) => { const x = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); const e = x.toISOString().slice(0, 10); return e > today ? today : e; };
    const coll = new Map((await all(env, `SELECT strftime('%Y-%m', (h.done_at / 1000) + ?, 'unixepoch') AS m, COALESCE(SUM(CAST(json_extract(h.proof_json, '$.amount') AS REAL)), 0) AS amt, COUNT(*) AS n
        FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.dept = 'posting' AND h.status = 'complete' AND h.client_id = ? AND h.done_at BETWEEN ? AND ?${lw} GROUP BY m`,
      IST_MIN * 60, clientId, t0(months[0] + "-01"), t1(mEnd(months[5])), ...la)).map((x) => [x.m, x]));
    const trend = [];
    for (const m of months) {
      const e = mEnd(m); let ar = null, arN = null;
      if (e >= m + "-01") {
        const sn = await one(env, "SELECT day, cells_json FROM inv_snapshots WHERE client_id = ? AND day <= ? AND day >= ? ORDER BY day DESC LIMIT 1", clientId, e, m + "-01");
        if (sn) { let cells = []; try { cells = JSON.parse(sn.cells_json); } catch {} if (loc) cells = cells.filter((x) => x.loc === loc); ar = cells.reduce((a, x) => a + (x.amt || 0), 0); arN = cells.reduce((a, x) => a + (x.n || 0), 0); }
        else if (!loc) { const cs = await one(env, "SELECT ar_balance, ar_claims FROM client_snapshots WHERE client_id = ? AND day <= ? AND day >= ? ORDER BY day DESC LIMIT 1", clientId, e, m + "-01"); if (cs) { ar = cs.ar_balance; arN = cs.ar_claims; } }
        if (e === today && ar == null && invNow.source === "live") { ar = invNow.rows.reduce((a, x) => a + x.amt, 0); arN = invNow.rows.length; }
      }
      const c = coll.get(m); trend.push({ m, ar: ar == null ? null : Math.round(ar * 100) / 100, ar_n: arN, coll: c ? Math.round(c.amt * 100) / 100 : 0, coll_n: c ? c.n : 0 });
    }
    // what the client is asked for right now: hand-off requests waiting on them, and AR claims whose ball is with the client
    const [deskAsk, arAsk] = await Promise.all([
      all(env, `SELECT h.reason AS what, h.dept, COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS amt, MIN(h.paused_at) AS since, SUM(h.client_sent_at IS NOT NULL) AS sent
        FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.client_id = ? AND h.status = 'client'${lw} GROUP BY h.reason, h.dept`, clientId, ...la),
      all(env, `SELECT CASE WHEN c.last_sub_status <> '' THEN c.last_sub_status ELSE 'Information from the client' END AS what, COUNT(*) AS n, COALESCE(SUM(c.balance), 0) AS amt, MIN(c.last_worked_on) AS since
        FROM claims c WHERE c.client_id = ? AND c.state IN ${WORKABLE} AND c.last_bucket = 'Client'${lw} GROUP BY 1`, clientId, ...la),
    ]);
    const asks = deskAsk.map((x) => ({ what: x.what || "Information from the client", dept: DEPT_LABEL[x.dept] || x.dept, n: x.n, amt: Math.round(x.amt * 100) / 100, since: x.since ? istISO(x.since) : "", sent: x.sent || 0 }))
      .concat(arAsk.map((x) => ({ what: x.what, dept: "AR", n: x.n, amt: Math.round(x.amt * 100) / 100, since: isoDate(x.since) || "", sent: null })))
      .sort((a, b) => b.amt - a.amt);
    const edits = {};
    for (const e of await all(env, "SELECT page_id, json, by_name, at FROM creport_edits WHERE client_id = ? AND period_key = ? AND loc = ?", clientId, periodKey, loc)) edits[e.page_id] = { ...jsonObj(e.json), _by: e.by_name, _at: e.at };
    const locs = await all(env, "SELECT id, name FROM locations WHERE client_id = ? AND active = 1 ORDER BY name", clientId);
    // EV: the rows of the uploaded EV files in both periods (a location's report adds the files kept for the whole client)
    const ew = loc ? " AND (location_id = ? OR location_id = '')" : "";
    data.ev = (await all(env, `SELECT acct, dos, payer, status, action, work_date, done_by, comment, location_id FROM ev_rows WHERE client_id = ? AND work_date BETWEEN ? AND ?${ew} ORDER BY work_date LIMIT 60000`, clientId, pfrom, to, ...la))
      .map((x) => ({ id: "", no: x.acct, dos: x.dos, py: x.payer, st: x.status, act: x.action, wd: x.work_date, by: x.done_by, cm: x.comment, loc: x.location_id }));
    const evFiles = (await all(env, `SELECT id, file_name, from_day, to_day, n, by_name, at, location_id FROM ev_batches WHERE client_id = ? AND from_day <= ? AND to_day >= ?${ew} ORDER BY at DESC LIMIT 20`, clientId, to, pfrom, ...la))
      .map((x) => ({ id: x.id, file: x.file_name, from: x.from_day, to: x.to_day, n: x.n, by: x.by_name, at: x.at, all_locations: !x.location_id }));
    // reports made before for this client (a period with the team's words, or one created from the start screen)
    const made = (await all(env, `SELECT period_key, MAX(at) AS at FROM creport_edits WHERE client_id = ? AND loc = ? GROUP BY period_key ORDER BY at DESC LIMIT 8`, clientId, loc))
      .map((x) => ({ period_key: x.period_key, at: x.at }));
    return { client: { id: client.id, name: client.name, logo: client.logo || "" }, locations: locs, location_id: loc, period_key: periodKey, today,
      period: { from, to, prev_from: pfrom, prev_to: pto }, data, trend, asks, edits, ev_files: evFiles, made, can_edit: canEditClient(user, clientId), prepared_by: user.name || "" };
  },
  /* A supervisor's words on a report page (title, insights, RCA and plan, the asks, the focus, which pages print), kept for the
     client, period and location and shared with everyone who opens that report. A save says which saved copy of the page it was
     made on (base_at: the copy's time, or none when the page had no saved words yet). When someone else saved the page since,
     it is refused, so nobody's change is lost without a word: the page then reloads and shows theirs. */
  "creport.save": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (user.role !== "supervisor") throw denied("The Client 360 report is for team leads and above.");
    editableOr(user, clientId);
    const periodKey = String(payload.period_key || "");
    if (!/^(month|week|custom):[0-9:-]{7,40}$/.test(periodKey)) throw bad("Unknown report period.");
    const pageId = str(payload.page_id, 40);
    if (!/^[a-z0-9_]{2,40}$/.test(pageId)) throw bad("Unknown report page.");
    const loc = payload.location_id ? str(payload.location_id, 60) : "";
    const json = JSON.stringify(payload.data && typeof payload.data === "object" ? payload.data : {});
    if (json.length > 40000) throw bad("That is too much text for one page.");
    const base = payload.base_at == null || payload.base_at === "" ? null : num(payload.base_at, -1);
    const at = base == null ? Date.now() : Math.max(Date.now(), base + 1), by = user.name || "";
    const r = base == null
      ? await run(env, `INSERT INTO creport_edits (client_id, period_key, loc, page_id, json, by_name, at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (client_id, period_key, loc, page_id) DO NOTHING`,
        clientId, periodKey, loc, pageId, json, by, at)
      : await run(env, "UPDATE creport_edits SET json = ?, by_name = ?, at = ? WHERE client_id = ? AND period_key = ? AND loc = ? AND page_id = ? AND at = ?", json, by, at, clientId, periodKey, loc, pageId, base);
    if (!changesOf(r)) {
      const cur = await one(env, "SELECT by_name, at FROM creport_edits WHERE client_id = ? AND period_key = ? AND loc = ? AND page_id = ?", clientId, periodKey, loc, pageId);
      throw new ApiError(409, `${(cur && cur.by_name) || "Someone else"} changed this page${cur ? " at " + hhmmIST(cur.at) + " IST" : ""} after you opened it, so your change was not saved. The page now shows theirs: make your change again.`);
    }
    await audit(env, user, "creport.edit", clientId, `${pageId} · ${periodKey}${loc ? " · location" : ""}`);
    return { ok: true, at, by };
  },
  /* EV production for the client report. Brahmastra does not do eligibility checks, so the team uploads the EV file from
     OneDrive; the browser reads it and sends only the columns the report uses (no patient names). A file replaces what
     was kept for the same client, location and dates: in each month it has checks in, from its first to its last check
     there, so a stray date in another month never wipes the months in between. */
  "creport.evUpload": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (user.role !== "supervisor") throw denied("The Client 360 report is for team leads and above.");
    editableOr(user, clientId);
    const loc = payload.location_id ? str(payload.location_id, 60) : "";
    if (loc && !(await one(env, "SELECT id FROM locations WHERE id = ? AND client_id = ?", loc, clientId))) throw bad("Unknown location.");
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw bad("The file has no EV rows.");
    if (rows.length > 20000) throw bad("Up to 20,000 EV rows at a time.");
    const clean = [];
    for (const x of rows) { const wd = x && isoDate(x.wd); if (!wd) continue;
      clean.push([isoDate(x.dos) || "", str(x.no, 60), str(x.py, 120), str(x.st, 120), str(x.act, 120), str(x.by, 80), str(x.cm, 300), wd]); }
    if (!clean.length) throw bad("No row has the date the check was done.");
    let from = clean[0][7], to = from; for (const c of clean) { if (c[7] < from) from = c[7]; if (c[7] > to) to = c[7]; }
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) throw bad("One EV file can cover up to a year.");
    // the dates the file really covers: its first to its last check in each month it has checks in
    const spans = new Map();
    for (const c of clean) { const s = spans.get(c[7].slice(0, 7)); if (!s) spans.set(c[7].slice(0, 7), [c[7], c[7]]); else { if (c[7] < s[0]) s[0] = c[7]; if (c[7] > s[1]) s[1] = c[7]; } }
    const batch = uuid(), now = Date.now(), file = str(payload.file_name, 200) || "EV file";
    const touched = (await all(env, "SELECT id FROM ev_batches WHERE client_id = ? AND location_id = ? AND from_day <= ? AND to_day >= ?", clientId, loc, to, from)).map((x) => x.id);
    for (const [a, b] of spans.values()) await run(env, "DELETE FROM ev_rows WHERE client_id = ? AND location_id = ? AND work_date BETWEEN ? AND ?", clientId, loc, a, b);
    const stmts = [], per = 8;
    for (let i = 0; i < clean.length; i += per) {
      const part = clean.slice(i, i + per);
      stmts.push(env.DB.prepare("INSERT INTO ev_rows (id, client_id, location_id, batch_id, dos, acct, payer, status, action, done_by, comment, work_date) VALUES " + part.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(","))
        .bind(...part.flatMap((c) => [uuid(), clientId, loc, batch, ...c])));
    }
    stmts.push(env.DB.prepare("INSERT INTO ev_batches (id, client_id, location_id, file_name, from_day, to_day, n, by_name, at) VALUES (?,?,?,?,?,?,?,?,?)").bind(batch, clientId, loc, file, from, to, clean.length, user.name || "", now));
    await batchAll(env, stmts, 50);
    // files that lost rows to this one: their counts follow, and a file with nothing left goes
    for (const id of touched) {
      const n = await one(env, "SELECT COUNT(*) AS n FROM ev_rows WHERE batch_id = ?", id);
      if (n && n.n) await run(env, "UPDATE ev_batches SET n = ? WHERE id = ?", n.n, id); else await run(env, "DELETE FROM ev_batches WHERE id = ?", id);
    }
    await audit(env, user, "creport.ev", clientId, `${file}: ${clean.length} EV rows, ${from} to ${to}${loc ? " · location" : ""}`);
    return { ok: true, id: batch, n: clean.length, from, to, skipped: rows.length - clean.length };
  },
  "creport.evRemove": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60), id = str(payload.id, 60);
    if (user.role !== "supervisor") throw denied("The Client 360 report is for team leads and above.");
    editableOr(user, clientId);
    const b = await one(env, "SELECT id, file_name, n FROM ev_batches WHERE id = ? AND client_id = ?", id, clientId);
    if (!b) throw bad("That EV file is not kept any more.");
    await batchAll(env, [env.DB.prepare("DELETE FROM ev_rows WHERE batch_id = ?").bind(id), env.DB.prepare("DELETE FROM ev_batches WHERE id = ?").bind(id)]);
    await audit(env, user, "creport.ev", clientId, `${b.file_name}: removed (${b.n} EV rows)`);
    return { ok: true };
  },
  /* The client's logo on the client report: a small image (PNG, JPEG or WebP, up to about 200 KB as a data URL); empty removes it. */
  "clients.setLogo": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (user.role !== "supervisor") throw denied("Only team leads and above can change a client's logo.");
    editableOr(user, clientId);
    const logo = String(payload.logo || "");
    if (logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 280000)) throw bad("Use a PNG, JPEG or WebP image under 200 KB.");
    await run(env, "UPDATE clients SET logo = ? WHERE id = ?", logo, clientId);
    await audit(env, user, "client.logo", clientId, logo ? "logo set" : "logo removed");
    return { ok: true };
  },
  /* ---- Client 360: everything about one client on one page ---- */
  "client.overview": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (!inScope(user, clientId)) throw outOfScope();
    const c = await one(env, "SELECT * FROM clients WHERE id = ?", clientId);
    if (!c) throw bad("Unknown client.");
    await snapshotIfStale(env);
    const now = Date.now(), today = isoDate(payload.today) || isoToday();
    const from = num(payload.from_ms, now - 30 * 86400000), to = num(payload.to_ms, now), span = Math.max(86400000, to - from);
    const ageSql = "CASE WHEN dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN COALESCE(julianday(?) - julianday(substr(dos, 1, 10)), age_days) ELSE age_days END";
    // over 90 and over 120 are of the money owed: credit balances are left out (the Dashboard's rule), so a tile's dollars and its share are the same money
    const ar = await one(env, `SELECT COALESCE(SUM(balance), 0) AS bal, COUNT(*) AS n, SUM(CASE WHEN age > 90 AND balance > 0 THEN 1 ELSE 0 END) AS o90n,
        COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS balp, COALESCE(SUM(CASE WHEN age > 90 AND balance > 0 THEN balance ELSE 0 END), 0) AS o90p,
        COALESCE(SUM(CASE WHEN age > 120 AND balance > 0 THEN balance ELSE 0 END), 0) AS o120 FROM (SELECT balance, ${ageSql} AS age FROM claims WHERE client_id = ? AND state IN ${WORKABLE})`, today, clientId);
    // a month ago, from the snapshots, for the change
    const monthAgo = await one(env, "SELECT ar_balance, over90_balance FROM client_snapshots WHERE client_id = ? AND day <= ? ORDER BY day DESC LIMIT 1", clientId, istISO(now - 30 * 86400000));
    const snaps = await all(env, `SELECT day, ar_balance, over90_balance, ar_claims, ar_owed, over90_owed FROM client_snapshots WHERE client_id = ? AND day >= ? ORDER BY day`, clientId, istISO(now - 190 * 86400000));
    const byMonth = new Map(); for (const sn of snaps) byMonth.set(sn.day.slice(0, 7), sn);
    // the over-90 share of the money owed, as on the tile (a reading kept before the money owed was kept falls back to the net figures)
    const trend = [...byMonth.entries()].slice(-6).map(([m, sn]) => { const owed = sn.ar_owed != null, o90 = owed ? sn.over90_owed : sn.over90_balance, base = owed ? sn.ar_owed : sn.ar_balance;
      return { month: m, ar: sn.ar_balance, over90: o90, pct: base ? Math.round(o90 / base * 1000) / 10 : 0, claims: sn.ar_claims, day: sn.day }; });
    const paid = async (a, b) => (await one(env, `SELECT COALESCE(SUM(CAST(json_extract(proof_json, '$.amount') AS REAL)), 0) AS amt, COUNT(*) AS n FROM handoffs WHERE client_id = ? AND dept = 'posting' AND status = 'complete' AND done_at BETWEEN ? AND ?`, clientId, a, b));
    const coll = await paid(from, to), collPrev = await paid(from - span, from);
    const waiting = await all(env, `SELECT h.id, h.dept, h.reason, h.note, h.paused_at, h.client_sent_at, h.client_sent_by_name, h.client_sent_how, h.chase_at, c.claim_no, c.patient, c.balance
      FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE h.client_id = ? AND h.status = 'client'${deskDepts(user) ? ` AND h.dept IN (${deskDepts(user).map(() => "?").join(",")})` : ""} ORDER BY h.paused_at ASC LIMIT 100`, clientId, ...(deskDepts(user) || []));
    const replyAvg = async (cid) => { const r = await one(env, `SELECT AVG(client_answered_at - COALESCE(client_sent_at, paused_at)) AS ms, COUNT(*) AS n FROM handoffs WHERE client_answered_at IS NOT NULL AND client_answered_at > ?${cid ? " AND client_id = ?" : ""}`, now - 90 * 86400000, ...(cid ? [cid] : [])); return r && r.n ? { days: Math.round(r.ms / 864000) / 100, n: r.n } : null; };
    // each claim once per reason: a claim denied twice in the dates is one claim and its balance once
    const reasons = await all(env, `SELECT reason, COUNT(*) AS n, COALESCE(SUM(bal), 0) AS bal FROM (SELECT COALESCE(NULLIF(n.sub_status, ''), 'Other') AS reason, n.claim_id, MAX(c.balance) AS bal
      FROM notes n JOIN claims c ON c.id = n.claim_id WHERE c.client_id = ? AND n.kind = 'work' AND n.created_at BETWEEN ? AND ? AND COALESCE(NULLIF(n.status, ''), n.status_code) IN ('Claim Denied', 'Claim Rejected')
      GROUP BY reason, n.claim_id) GROUP BY reason ORDER BY bal DESC LIMIT 6`, clientId, from, to);
    const lim = (await OPS["payers.limits"]({ env, user, payload: { today } })).rows.filter((r) => r.client_id === clientId);
    const tfl = lim.reduce((a, r) => ({ soon_bal: a.soon_bal + r.soon_bal, soon_n: a.soon_n + r.soon_n, past_bal: a.past_bal + r.past_bal, past_n: a.past_n + r.past_n }), { soon_bal: 0, soon_n: 0, past_bal: 0, past_n: 0 });
    const esc = (await trackerEsc(env, clientId)).get(clientId) || { n: 0, late: 0 };
    const missed = (await missedByClient(env, payload)).get(clientId) || { ar: 0, posting: 0, submission: 0 };
    const worked = await one(env, "SELECT COUNT(*) AS n, COUNT(DISTINCT n.user_id) AS people FROM notes n JOIN claims c ON c.id = n.claim_id WHERE c.client_id = ? AND n.kind = 'work' AND n.created_at BETWEEN ? AND ?", clientId, from, to);
    const month = okMonth(payload.month, today) ? payload.month : closingMonth(today);
    const me = new Map((await all(env, "SELECT * FROM client_monthend WHERE client_id = ? AND month = ?", clientId, month)).map((r) => [r.step, r]));
    const monthend = MONTHEND_STEPS.map(([key, label, due, auto]) => { const r = me.get(key); return { key, label, auto, due: nthWorkingDayAfter(month, due), done: !!(r && r.done_at), done_at: r ? r.done_at : null, done_by_name: r ? r.done_by_name : "", by_itself: !!(r && r.auto), score: r ? r.score : null, note: r ? r.note : "" }; });
    const slaRow = await one(env, "SELECT month, score, done_at FROM client_monthend WHERE client_id = ? AND step = 'sla' AND score IS NOT NULL ORDER BY month DESC LIMIT 2", clientId);
    const slaPrev = slaRow ? await one(env, "SELECT score FROM client_monthend WHERE client_id = ? AND step = 'sla' AND score IS NOT NULL AND month < ? ORDER BY month DESC LIMIT 1", clientId, slaRow.month) : null;
    const log = await all(env, "SELECT id, at, kind, text, next_on, by_name, by_id FROM client_log WHERE client_id = ? ORDER BY at DESC LIMIT 30", clientId);
    const raci = (await OPS["raci.list"]({ env, user, payload })).rows.find((r) => r.client_id === clientId) || null;
    const team = parseTeam(c.team_json).length;
    const locs = (await all(env, "SELECT name FROM locations WHERE client_id = ? AND active = 1 ORDER BY name", clientId)).map((l) => l.name);
    // health: plain reasons, worst first
    const pct = ar.balp ? Math.round(ar.o90p / ar.balp * 1000) / 10 : 0;
    const oldest = waiting.length ? Math.floor((now - (waiting[0].client_sent_at || waiting[0].paused_at || now)) / 86400000) : 0;
    const { health, reasons: reasonsOut } = healthOf({ pct, sla: slaRow, tfl, escLate: esc && esc.late, waitingN: waiting.length, oldest, missed: missed.ar + missed.posting + missed.submission });
    return {
      client: { id: c.id, name: c.name, code: c.code, active: !!c.active, created_at: c.created_at, team, locations: locs },
      raci, health, reasons: reasonsOut.slice(0, 4),
      ar: { balance: ar.bal, claims: ar.n, over90: ar.o90p || 0, over90_claims: ar.o90n || 0, over90_pct: pct, over120: ar.o120, target: OVER90_TARGET, month_ago: monthAgo ? monthAgo.ar_balance : null,
        owed: ar.balp || 0, over90_owed: ar.o90p || 0 },
      collected: { amount: coll.amt, n: coll.n, prev: collPrev.amt },
      waiting: { rows: waiting.map((w) => ({ ...w, days: Math.floor((now - (w.client_sent_at || w.paused_at || now)) / 86400000), sent: !!w.client_sent_at, dept_label: DEPT_LABEL[w.dept] || w.dept })),
        balance: waiting.reduce((a, w) => a + (w.balance || 0), 0), oldest, reply: await replyAvg(clientId), reply_all: await replyAvg(null) },
      reasons_top: reasons, tfl, escalations: { open: (esc && esc.n) || 0, late: (esc && esc.late) || 0 }, missed, worked: { entries: (worked && worked.n) || 0, people: (worked && worked.people) || 0 },
      sla: slaRow ? { score: slaRow.score, month: slaRow.month, prev: slaPrev ? slaPrev.score : null } : null,
      trend, first_snapshot: snaps.length ? snaps[0].day : null,
      monthend: { month, steps: monthend, done: monthend.filter((x) => x.done).length, can_edit: canEditClient(user, clientId) && user.role === "supervisor" },
      log: log.map((l) => ({ ...l, mine: l.by_id === user.id })),
    };
  },
  "client.logAdd": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    editableOr(user, clientId);
    const kind = ["call", "email", "meeting", "note", "next"].includes(payload.kind) ? payload.kind : "note";
    // never cut a note short without a word: a longer one is refused and the person shortens it or splits it
    const text = (typeof payload.text === "string" ? payload.text : str(payload.text, 4000)).trim();
    if (text.length > CALL_LOG_MAX) throw bad(`This entry is ${text.length.toLocaleString("en-US")} characters; the call log keeps up to ${CALL_LOG_MAX.toLocaleString("en-US")}. Shorten it, or add the rest as a second entry.`);
    if (!commentOk(text)) throw bad("Write what was said or decided, a few words at least.");
    const next = isoDate(payload.next_on) || "";
    if (kind === "next" && !next) throw bad("Pick the date of the next call.");
    if (next && next < istISO(Date.now() - 86400000)) throw bad("The next call date is in the past. Pick today or a later day.");
    const id = uuid();
    await run(env, "INSERT INTO client_log (id, client_id, at, kind, text, next_on, by_id, by_name) VALUES (?,?,?,?,?,?,?,?)", id, clientId, Date.now(), kind, text, next, user.id, user.name || "");
    await audit(env, user, "client.log", clientId, kind + ": " + text.slice(0, 80));
    return { ok: true, id };
  },
  "client.logDelete": async ({ env, user, payload }) => {
    const l = await one(env, "SELECT * FROM client_log WHERE id = ?", str(payload.id, 60));
    if (!l) throw bad("That entry is no longer there.");
    editableOr(user, l.client_id);
    if (l.by_id !== user.id && !(user.role === "supervisor" && !isSME(user))) throw denied("Only the person who wrote it or a team lead can remove it.");
    await run(env, "DELETE FROM client_log WHERE id = ?", l.id);
    await audit(env, user, "client.logRemove", l.client_id, `${l.kind} by ${l.by_name || "someone"} on ${istISO(l.at)}: ${String(l.text || "").slice(0, 80)}`);
    return { ok: true };
  },
  "monthend.set": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    editableOr(user, clientId);
    const step = MONTHEND_STEPS.find(([k]) => k === payload.step);
    if (!step) throw bad("Pick the month and the step.");
    const month = okMonth(payload.month, istISO(Date.now())) ? payload.month : null;
    if (!month) throw bad("Pick a month from January to December, not later than this month.");
    if (payload.done === false) {
      const was = await one(env, "SELECT done_at FROM client_monthend WHERE client_id = ? AND month = ? AND step = ?", clientId, month, step[0]);
      await run(env, "DELETE FROM client_monthend WHERE client_id = ? AND month = ? AND step = ?", clientId, month, step[0]);
      if (was && was.done_at) await audit(env, user, "monthend." + step[0], clientId, monthName(month) + " · marked not done");
      return { ok: true };
    }
    let score = null;
    if (step[0] === "sla") {
      score = payload.score == null || payload.score === "" || typeof payload.score === "boolean" ? NaN : Number(payload.score);
      if (!(score >= 0 && score <= 100)) throw bad("Type the SLA score from the scorecard, 0 to 100.");
      score = Math.round(score * 10) / 10;
    }
    await run(env, `INSERT INTO client_monthend (client_id, month, step, done_at, done_by_name, auto, score, note) VALUES (?,?,?,?,?,0,?,?)
      ON CONFLICT (client_id, month, step) DO UPDATE SET done_at = excluded.done_at, done_by_name = excluded.done_by_name, auto = 0, score = excluded.score, note = excluded.note`,
      clientId, month, step[0], Date.now(), user.name || "", score, str(payload.note, 300).trim());
    await audit(env, user, "monthend." + step[0], clientId, monthName(month) + (score != null ? " · SLA " + score + "%" : ""));
    return { ok: true };
  },
  /* The scorecard page ticks "AR Inventory sent to the SLA scorecard" when Brahmastra adds it there. */
  "monthend.mark": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    editableOr(user, clientId);
    if (payload.step !== "sla_inventory") throw bad("Only that step is ticked this way.");
    await monthendAuto(env, clientId, closingMonth(isoDate(payload.today) || isoToday()), "sla_inventory", user.name);
    return { ok: true };
  },

  /* ---- RACI tracker: who is Responsible, Accountable, Consulted and Informed on each client.
     Everyone from SME up can read it; team leads and up edit it; the VP is always informed. ---- */
  "raci.list": async ({ env, user, payload }) => {
    const clients = (await all(env, "SELECT id, name, team_json, roster_names_json FROM clients WHERE active = 1 ORDER BY name")).filter((c) => inScope(user, c.id));
    // Missed tasks per client: AR = allocated before today and still not worked; posting / submission = past the
    // 24-hour TAT (still open) or finished late in the last 30 days.
    const now = Date.now(), since = now - 30 * 86400000;
    const dayStart = (() => { const t = isoDate(payload.today); const off = Math.round(num(payload.tz_offset_min, IST_MIN)); return t ? Date.parse(t + "T00:00:00Z") - off * 60000 : now - (now % 86400000); })();
    const arMiss = new Map((await all(env, `SELECT client_id, COUNT(*) AS n FROM claims WHERE state IN ('assigned','in_progress') AND assigned_at IS NOT NULL AND assigned_at < ? GROUP BY client_id`, dayStart)).map((r) => [r.client_id, r.n]));
    const hoMiss = await all(env, `SELECT client_id, CASE WHEN dept = 'posting' THEN 'posting' ELSE 'submission' END AS grp, COUNT(*) AS n FROM handoffs
      WHERE ((status IN ('pending','assigned','client') AND due_at < ?) OR (done_at IS NOT NULL AND done_at > due_at AND done_at >= ?)) GROUP BY client_id, grp`, now, since);
    const poMiss = new Map(hoMiss.filter((r) => r.grp === "posting").map((r) => [r.client_id, r.n]));
    const suMiss = new Map(hoMiss.filter((r) => r.grp === "submission").map((r) => [r.client_id, r.n]));
    const saved = new Map((await all(env, "SELECT * FROM raci")).map((r) => [r.client_id, r]));
    const users = await all(env, "SELECT id, name, role, roster_kind, designation, department, projects_json, scope_projects_json, access_all FROM users WHERE active = 1");
    const vpRow = users.find((u) => u.access_all) || null;
    const person = (u) => ({ id: u.id, name: u.name });
    const tlRe = /\b(sr\.? )?tl\b|team lead/i;
    const rows = clients.map((c) => {
      const names = new Set(jsonList(c.roster_names_json).map(projKey));
      const onClient = (u) => jsonList(u.projects_json).some((p) => names.has(projKey(p && p.name != null ? p.name : p)));
      const team = new Set(parseTeam(c.team_json));
      const sv = saved.get(c.id);
      // Until someone saves a row, it is filled from the roster: billers on the client, their team leads, their manager, the VP.
      const r = sv ? jsonList(sv.r_json) : users.filter((u) => u.role === "user" && (team.has(u.id) || onClient(u))).slice(0, 10).map(person);
      const a = sv ? jsonList(sv.a_json) : users.filter((u) => u.role !== "user" && u.roster_kind === "lead" && tlRe.test(u.designation || "") && onClient(u)).slice(0, 5).map(person);
      const cn = sv ? jsonList(sv.c_json) : users.filter((u) => u.roster_kind === "manager" && jsonList(u.scope_projects_json).some((n) => names.has(projKey(n)))).slice(0, 5).map(person);
      let i = sv ? jsonList(sv.i_json) : [];
      if (vpRow) i = [person(vpRow), ...i.filter((x) => x.id !== vpRow.id)];
      return { client_id: c.id, client: c.name, r, a, c: cn, i: i.slice(0, 2), saved: !!sv,
        missed: { ar: arMiss.get(c.id) || 0, posting: poMiss.get(c.id) || 0, submission: suMiss.get(c.id) || 0 },
        updated_at: sv ? sv.updated_at : null, updated_by_name: sv ? sv.updated_by_name : "",
        can_edit: user.role === "supervisor" && !isSME(user) && canEditClient(user, c.id) };
    });
    return { rows, vp: vpRow ? person(vpRow) : null,
      people: users.map((u) => ({ id: u.id, name: u.name, designation: u.designation || (u.role === "user" ? "Biller" : "Supervisor"), department: u.department || "" })) };
  },
  /* The claims behind one missed-task count, for the drop-down with patient names. */
  "raci.missed": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (!inScope(user, clientId)) throw outOfScope();
    const kind = ["ar", "posting", "submission"].includes(payload.kind) ? payload.kind : "ar";
    // desk people see the missed tasks of their own desk only, never AR's (claims on billers' lists)
    if (deskDepts(user) && !deskDepts(user).includes(kind)) throw denied("That is AR's work or another desk's. Your desk is " + DESK_NAME[deskOf(user)] + ".");
    const now = Date.now(), since = now - 30 * 86400000;
    const dayStart = (() => { const t = isoDate(payload.today); const off = Math.round(num(payload.tz_offset_min, IST_MIN)); return t ? Date.parse(t + "T00:00:00Z") - off * 60000 : now - (now % 86400000); })();
    if (kind === "ar") {
      const rows = await all(env, `SELECT c.id, c.claim_no, c.patient, c.payer, c.balance, c.state, c.assigned_at, u.name AS who FROM claims c LEFT JOIN users u ON u.id = c.assigned_to
        WHERE c.client_id = ? AND c.state IN ('assigned','in_progress') AND c.assigned_at IS NOT NULL AND c.assigned_at < ? ORDER BY c.assigned_at LIMIT 200`, clientId, dayStart);
      return { kind, rows };
    }
    const depts = kind === "posting" ? "('posting')" : "('submission','subcheck','rejection')";
    const rows = await all(env, `SELECT h.id, h.dept, h.status, h.due_at, h.done_at, c.claim_no, c.patient, c.payer, c.balance, COALESCE(a.name, l.name, '') AS who
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN users a ON a.id = h.assigned_to LEFT JOIN users l ON l.id = h.lead_id
      WHERE h.client_id = ? AND h.dept IN ${depts} AND ((h.status IN ('pending','assigned','client') AND h.due_at < ?) OR (h.done_at IS NOT NULL AND h.done_at > h.due_at AND h.done_at >= ?))
      ORDER BY COALESCE(h.done_at, h.due_at) DESC LIMIT 200`, clientId, now, since);
    return { kind, rows };
  },
  "raci.save": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    editableOr(user, clientId);
    if (isSME(user)) throw denied("The RACI is edited by team leads and up; you can read it.");
    if (!(await one(env, "SELECT id FROM clients WHERE id = ?", clientId))) throw bad("Unknown client.");
    const users = new Map((await all(env, "SELECT id, name, access_all FROM users WHERE active = 1")).map((u) => [u.id, u]));
    const clean = (v, cap) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x && x.id != null ? x.id : x, 60)).filter((id) => users.has(id)))].slice(0, cap).map((id) => ({ id, name: users.get(id).name }));
    const r = clean(payload.r, 10), a = clean(payload.a, 5), cn = clean(payload.c, 5);
    // Informed holds at most two people, and the VP is always the first.
    const vp = [...users.values()].find((u) => u.access_all) || null;
    let i = clean(payload.i, 3);
    if (vp) i = [{ id: vp.id, name: vp.name }, ...i.filter((x) => x.id !== vp.id)];
    i = i.slice(0, 2);
    await run(env, `INSERT INTO raci (client_id, r_json, a_json, c_json, i_json, updated_at, updated_by, updated_by_name) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (client_id) DO UPDATE SET r_json = excluded.r_json, a_json = excluded.a_json, c_json = excluded.c_json, i_json = excluded.i_json,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name`,
      clientId, JSON.stringify(r), JSON.stringify(a), JSON.stringify(cn), JSON.stringify(i), Date.now(), user.id, user.name);
    await audit(env, user, "raci.save", clientId, ["R " + r.map((x) => x.name).join(", "), "A " + a.map((x) => x.name).join(", "), "C " + cn.map((x) => x.name).join(", "), "I " + i.map((x) => x.name).join(", ")].join(" · "));
    return { row: { client_id: clientId, r, a, c: cn, i } };
  },
  "clients.saveTeam": async ({ env, user, payload }) => {
    const table = payload.location_id ? "locations" : "clients";
    const id = str(payload.location_id || payload.client_id, 60);
    const ex = await one(env, `SELECT id, ${payload.location_id ? "client_id" : "id AS client_id"} FROM ${table} WHERE id = ?`, id);
    if (!ex) throw bad("Unknown " + (payload.location_id ? "location" : "client") + ".");
    editableOr(user, ex.client_id);
    const ids = [...new Set((Array.isArray(payload.team) ? payload.team : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 100);
    const valid = ids.length ? (await all(env, `SELECT id FROM users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((u) => u.id) : [];
    const team = ids.filter((x) => valid.includes(x));
    const auto = payload.auto_allocate === false ? 0 : 1;
    const old = await one(env, `SELECT team_json, auto_allocate, name FROM ${table} WHERE id = ?`, ex.id);
    await run(env, `UPDATE ${table} SET team_json = ?, auto_allocate = ? WHERE id = ?`, JSON.stringify(team), auto, ex.id);
    const was = parseTeam(old && old.team_json), add = team.filter((x) => !was.includes(x)), gone = was.filter((x) => !team.includes(x));
    const nm = await namesOf(env, [...add, ...gone]);
    const bits = [...(add.length ? ["added " + add.map((x) => nm.get(x)).join(", ")] : []), ...(gone.length ? ["removed " + gone.map((x) => nm.get(x) || "someone").join(", ")] : []), ...(old && !!old.auto_allocate !== !!auto ? [auto ? "auto-allocation on" : "auto-allocation off"] : [])];
    if (!payload.location_id) { const cl = await one(env, "SELECT id, name FROM clients WHERE id = ?", ex.client_id); await noticeResponsibility(env, user, cl, { team_json: old && old.team_json }, { team_json: JSON.stringify(team) }); }
    if (bits.length) await audit(env, user, "client.team", ex.client_id, (payload.location_id ? "Billers at " + (old && old.name) : "Billers on the client") + ": " + bits.join("; "));
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
      const ex = await one(env, "SELECT * FROM clients WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown client.");
      editableOr(user, ex.id);
      const changes = [];
      if (ex.name !== name) changes.push(`name ${ex.name} → ${name}`);
      if ((ex.code || "") !== code) changes.push(`code ${ex.code || "none"} → ${code || "none"}`);
      if (Number(ex.follow_up_days) !== fu) changes.push(`default follow-up ${ex.follow_up_days} → ${fu} day${fu === 1 ? "" : "s"}`);
      if (!!ex.active !== !!active) changes.push(active ? "made active" : "made inactive");
      if (link != null && (ex.workbook_link || "") !== link) changes.push(link ? "production file link set to " + link : "production file link removed (Brahmastra keeps it by itself)");
      await run(env, "UPDATE clients SET name = ?, code = ?, follow_up_days = ?, active = ?, workbook_link = CASE WHEN ? IS NULL THEN workbook_link ELSE ? END WHERE id = ?", name, code, fu, active, link, link, ex.id);
      if (payload.profile) {
        const locs = await one(env, "SELECT COUNT(*) AS n FROM locations WHERE client_id = ? AND active = 1", ex.id);
        const p = await checkProfile(env, payload.profile, { isNew: false, locations: (locs && locs.n) || 0 });
        const before = await describeProfile(env, ex);
        const sets = Object.keys(p.cols);
        await run(env, `UPDATE clients SET scope_json = ?, targets_json = ?, ${sets.map((k) => k + " = ?").join(", ")} WHERE id = ?`, JSON.stringify(p.scope), JSON.stringify(p.targets), ...sets.map((k) => p.cols[k]), ex.id);
        for (const d of ["posting", "submission", "rejection"]) { const [, l, b] = RESP_COLS[d]; if (p.cols[l]) await followHandoffs(env, ex.id, d, p.cols[l], p.cols[b]); }
        if (p.cols.submission_check_person) await followHandoffs(env, ex.id, "subcheck", p.cols.submission_check_person);
        const after = await describeProfile(env, { ...ex, ...p.cols, scope_json: JSON.stringify(p.scope), targets_json: JSON.stringify(p.targets) });
        changes.push(...diffLines(before, after));
        await noticeResponsibility(env, user, { id: ex.id, name }, ex, { ...ex, ...p.cols });
      }
      if (changes.length) await audit(env, user, "client.save", ex.id, changes.join("; "));
      return { client: { id: ex.id, name, code, follow_up_days: fu, active: !!active, workbook_link: link } };
    }
    // Team leads and above add clients (SMEs and billers cannot). Someone with a span gets edit access to the client they add, so it opens for them.
    if (user.scope && (user.role !== "supervisor" || isSME(user))) throw denied("Adding a client is for team leads and above. Ask your team lead.");
    // A new client needs its whole profile: scope of work, locations, targets, the people responsible.
    const locNames = [...new Set((Array.isArray(payload.locations) ? payload.locations : []).map((x) => str(x, 160).trim()).filter(Boolean))].slice(0, 50);
    const p = await checkProfile(env, payload.profile, { isNew: true, locations: locNames.length });
    if (await one(env, "SELECT id FROM clients WHERE lower(name) = lower(?)", name)) throw bad("A client with that name already exists.");
    const id = uuid(), now = Date.now();
    const sets = Object.keys(p.cols);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO clients (id, name, code, active, follow_up_days, created_by, created_at, workbook_link, scope_json, targets_json, ${sets.join(", ")}) VALUES (?,?,?,?,?,?,?,?,?,?,${sets.map(() => "?").join(",")})`)
        .bind(id, name, code, active, fu, user.id, now, link || "", JSON.stringify(p.scope), JSON.stringify(p.targets), ...sets.map((k) => p.cols[k])),
      ...locNames.map((l) => env.DB.prepare("INSERT INTO locations (id, client_id, name, active, created_at) VALUES (?,?,?,1,?)").bind(uuid(), id, l, now)),
      ...(user.scope ? [env.DB.prepare("INSERT INTO client_access (id, client_id, user_id, level, granted_by, granted_by_name, at) VALUES (?,?,?,'edit',?,?,?)").bind(uuid(), id, user.id, user.id, user.name || "", now)] : []),
    ]);
    await autoMapProjects(env);
    let created = await one(env, "SELECT * FROM clients WHERE id = ?", id);
    try { created = (await ensureClientFolders(env, id)) || created; } catch (e) { /* recorded on the client; the hourly job tries again */ }
    await noticeResponsibility(env, user, created, {}, created);
    await audit(env, user, "client.save", id, `created with locations ${locNames.join(", ")}; production file ${link ? link : "kept by Brahmastra"}; ` + (await describeProfile(env, created)).join("; "));
    return { client: { id, name, code, follow_up_days: fu, active: !!active, created_at: now, team: [], auto_allocate: true, locations: [], workbook_link: link || "" } };
  },
  /* Delete a client with everything under it: locations, uploads, claims, notes, allocation history. Confirmed by name on the screen. */
  "clients.delete": async ({ env, user, payload }) => {
    const ex = await one(env, "SELECT id, name FROM clients WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown client.");
    // Admins, the VP, and team leads and managers for a client in their own span (not one shared with them view-only). SMEs and billers cannot.
    if (user.scope) {
      if (user.role !== "supervisor" || isSME(user)) throw denied("Deleting a client is for team leads and managers. Ask your team lead.");
      editableOr(user, ex.id);
    }
    if (str(payload.confirm, 200).trim().toLowerCase() !== String(ex.name).trim().toLowerCase()) throw bad("Type the client's name exactly to confirm.");
    const n = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE client_id = ?", ex.id);
    await audit(env, user, "client.delete", null, ex.name + " · " + (n ? n.n : 0) + " claims");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM notes WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM attachment_parts WHERE attachment_id IN (SELECT a.id FROM attachments a JOIN claims c ON c.id = a.claim_id WHERE c.client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM attachments WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM claim_events WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM handoffs WHERE client_id = ? OR claim_id IN (SELECT id FROM claims WHERE client_id = ?)").bind(ex.id, ex.id),
      // Everything else kept per client: the escalation tracker, shares, RACI, insurance limits, month-end, snapshots, notices and the rest.
      ...["escalations", "client_access", "raci", "payer_limits", "client_monthend", "client_snapshots", "inv_snapshots", "user_notices", "availability", "detail_uploads",
        "ev_rows", "ev_batches", "creport_edits", "client_log", "digest_runs", "digest_log", "note_templates"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE client_id = ?`).bind(ex.id)),
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
      editableOr(user, ex.client_id);
      const old = await one(env, "SELECT name, active, workbook_link FROM locations WHERE id = ?", ex.id);
      await run(env, "UPDATE locations SET name = ?, active = ?, workbook_link = CASE WHEN ? IS NULL THEN workbook_link ELSE ? END WHERE id = ?", name, active, link, link, ex.id);
      const ch = [...(old.name !== name ? [`renamed ${old.name} → ${name}`] : []), ...(!!old.active !== !!active ? [active ? "reactivated" : "deactivated"] : []), ...(link != null && (old.workbook_link || "") !== link ? [link ? "production file link set" : "production file link removed"] : [])];
      if (ch.length) await audit(env, user, "client.location", ex.client_id, `Location ${old.name}: ` + ch.join("; "));
      return { location: { id: ex.id, client_id: ex.client_id, name, active: !!active, workbook_link: link } };
    }
    const client = await one(env, "SELECT id FROM clients WHERE id = ?", payload.client_id);
    if (!client) throw bad("Unknown client.");
    editableOr(user, client.id);
    const dup = await one(env, "SELECT id FROM locations WHERE client_id = ? AND lower(name) = lower(?)", client.id, name);
    if (dup) throw bad("That location already exists for this client.");
    const id = uuid(), now = Date.now();
    await run(env, "INSERT INTO locations (id, client_id, name, active, created_at) VALUES (?,?,?,?,?)", id, client.id, name, active, now);
    await audit(env, user, "client.location", client.id, "Location added: " + name);
    return { location: { id, client_id: client.id, name, active: !!active, created_at: now, team: [], auto_allocate: true } };
  },

  /* ---- settings ---- */
  /* The admin reads every setting. A team lead reads what the page uses: the pinned folder, the digest switch and the Production
     file status of their own clients; anyone else only the pinned folder. Sync state, sign-in lists and file ids stay on the server. */
  "settings.get": async ({ env, user }) => {
    const rows = await all(env, "SELECT * FROM settings");
    const sup = user && user.role === "supervisor";
    const shown = (k) => (user && user.is_admin) || SETTINGS_OPEN.includes(k) || (sup && (SETTINGS_LEAD.includes(k) || (k.startsWith("workbook_status:") && inScope(user, k.split(":")[1]))));
    const out = {};
    rows.filter((r) => shown(r.key)).forEach((r) => { try { out[r.key] = JSON.parse(r.value_json); } catch { out[r.key] = null; } });
    return { settings: out };
  },
  "settings.save": async ({ env, user, payload }) => {
    const s0 = payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings) ? payload.settings : {};
    // A team lead saves only the pinned folder; the admin also the other plain settings. Sign-in and roster settings have their own
    // admin screens (Roster), and what the server keeps for itself (sync state, file ids, file status, snapshot time) is never saved from here.
    const may = (k) => !SETTINGS_SERVER.test(k) && (SETTINGS_LEAD_SAVE.includes(k) || (user.is_admin && !SETTINGS_ADMIN_OWN.includes(k)));
    const s = Object.fromEntries(Object.entries(s0).filter(([k]) => may(k)));
    const stmts = Object.keys(s).slice(0, 50).map((k) => env.DB.prepare("INSERT INTO settings (key, value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").bind(str(k, 60), JSON.stringify(s[k])));
    if (stmts.length) { await batchAll(env, stmts); await audit(env, user, "settings.save", null, Object.keys(s).slice(0, 12).join(", ")); }
    return OPS["settings.get"]({ env, user });
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
      c._gen = !str(c.claim_no, 80).trim() && !!c._fp;   // no claim number in the file: Brahmastra makes one up (BR-...)
      if (c._gen) c.claim_no = generatedClaimNo(c._fp);
      c._alt = altKeyOf(c.claim_no);
      c._num = c._gen ? "" : c._alt;                      // the claim number's key; none for a made-up number
    });
    const byMatch = new Map(), byAlt = new Map(), byFp = new Map();
    const SEL = "SELECT id, match_key, alt_key, fp_key, claim_no, payer, state, touches, assigned_to, worked_before, last_worked_on, follow_up_on, inventory_kind FROM claims WHERE client_id = ? AND ";
    for (const chunk of chunks(rows.map((c) => str(c.match_key, 300)), 80)) (await all(env, SEL + `match_key IN (${chunk.map(() => "?").join(",")})`, client.id, ...chunk)).forEach((r) => byMatch.set(r.match_key, r));
    for (const chunk of chunks([...new Set(rows.map((c) => c._num).filter(Boolean))], 80)) (await all(env, SEL + `alt_key IN (${chunk.map(() => "?").join(",")})`, client.id, ...chunk)).forEach((r) => { if (!isGeneratedNo(r) && !byAlt.has(r.alt_key)) byAlt.set(r.alt_key, r); });
    for (const chunk of chunks([...new Set(rows.map((c) => c._fp).filter(Boolean))], 80)) (await all(env, SEL + `fp_key IN (${chunk.map(() => "?").join(",")}) ORDER BY created_at`, client.id, ...chunk)).forEach((r) => { if (!byFp.has(r.fp_key)) byFp.set(r.fp_key, []); byFp.get(r.fp_key).push(r); });
    const stmts = [];
    const taken = new Set(), altSeen = new Set();
    // A previously worked claim whose follow-up date is still to come is worked and waiting, like a claim worked in Brahmastra:
    // it is not in the pool, and comes back into it on that date.
    const today = isoDate(payload.today) || isoToday();
    const WAITS = "Worked before: back in the pool on its follow-up date";
    for (const c of rows) {
      const key = str(c.match_key, 300);
      // Two rows of one file whose claim numbers differ only in format ("D-55555" and "d55555") are one claim: the first row counts.
      if (c._num && !byMatch.has(key)) { if (altSeen.has(c._num)) { counts.skipped++; continue; } }
      if (c._num) altSeen.add(c._num);
      let ex = byMatch.get(key) || (c._num && byAlt.get(c._num)) || null;
      // Patient + DOS (and the payer, when both have one) only when one side has no claim number of its own.
      if (!ex && c._fp) ex = (byFp.get(c._fp) || []).find((f) => !taken.has(f.id) && (isGeneratedNo(f) || !f.alt_key || !c._num || f.alt_key === c._num) && samePayer(f.payer, c.payer)) || null;
      if (ex && taken.has(ex.id)) ex = null; // two rows of one file cannot both refresh the same claim
      if (ex) taken.add(ex.id);
      // a made-up number never replaces a claim's real one; a real one replaces a made-up one, with its key
      const keepNo = !!ex && c._gen && !!ex.claim_no && !isGeneratedNo(ex), gotNo = !!ex && !!c._num && isGeneratedNo(ex) ? 1 : 0;
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
      // Each upload's own copy of what the file said (status, action, comment, who worked it and when), so a claim in both the
      // September and the October worked file keeps both entries in its history even though the claim shows the latest file.
      const fileWork = (id) => (kind === "worked" || vals.file_comments ? claimEvent(env, id, user, "file_work", str(file_name, 200), fileSnapshot(kind, vals, c, lastWorked, followUp)) : null);
      if (!ex) {
        const waits = !exclude && !!followUp && followUp > today;
        const state = waits ? "completed" : !exclude ? "open" : closedInFile ? "closed" : "excluded";
        const reason = waits ? WAITS : !exclude ? "" : closedInFile ? "Closed in " + kind + " file" + (vals.file_status ? ": " + vals.file_status : "") : exclude;
        if (state === "open" || state === "completed") counts.inserted++; else if (state === "closed") counts.closed++; else counts.excluded++;
        const nid = uuid();
        const fw = fileWork(nid); if (fw) stmts.push(fw);
        stmts.push(env.DB.prepare(`INSERT INTO claims (id, client_id, location_id, batch_id, first_batch_id, match_key, claim_no, account_no, patient, payer, dos, cpt, provider,
            billed, balance, lines, lines_json, age_days, bucket, tier, status_class, file_status, file_sub_status, file_action, file_comments, file_bucket,
            inventory_kind, worked_before, last_worked_on, follow_up_on, priority, priority_reason, state, state_reason, raw_json, created_at, updated_at, alt_key, fp_key)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          nid, client.id, location_id || null, bid, bid, key, vals.claim_no, vals.account_no, vals.patient, vals.payer, vals.dos, vals.cpt, vals.provider,
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
      // an unassigned claim the worked file gives a later follow-up leaves the pool until that date (the date as the UPDATE below keeps it)
      if (newState === "open" && followUp) {
        const fu = !ex.last_worked_on || (lastWorked && lastWorked >= ex.last_worked_on) ? followUp : ex.follow_up_on;
        if (fu && fu > today) { newState = "completed"; reason = reason || WAITS; }
      }
      { const fw = fileWork(ex.id); if (fw) stmts.push(fw); }
      stmts.push(claimEvent(env, ex.id, user, "refreshed", str(file_name, 200), { kind, batch: bid, file_status: [vals.file_status, vals.file_sub_status].filter(Boolean).join(" · "), balance: vals.balance, ...(newState !== ex.state ? { changes: { state: [ex.state, newState] } } : {}) }));
      stmts.push(env.DB.prepare(`UPDATE claims SET location_id = COALESCE(?, location_id), batch_id = ?, claim_no = CASE WHEN ? <> '' THEN ? ELSE claim_no END,
          account_no = CASE WHEN ? <> '' THEN ? ELSE account_no END, patient = CASE WHEN ? <> '' THEN ? ELSE patient END, payer = CASE WHEN ? <> '' THEN ? ELSE payer END,
          dos = CASE WHEN ? <> '' THEN ? ELSE dos END, cpt = CASE WHEN ? <> '' THEN ? ELSE cpt END, provider = CASE WHEN ? <> '' THEN ? ELSE provider END,
          billed = COALESCE(?, billed), balance = ?, lines = ?, lines_json = ?, age_days = ?, bucket = ?, tier = ?, status_class = ?,
          file_status = ?, file_sub_status = ?, file_action = ?, file_comments = CASE WHEN ? <> '' THEN ? ELSE file_comments END, file_bucket = ?,
          inventory_kind = CASE WHEN ? = 'worked' THEN 'worked' ELSE inventory_kind END, worked_before = CASE WHEN ? = 'worked' THEN 1 ELSE worked_before END,
          last_worked_on = CASE WHEN ? <> '' AND ? > COALESCE(last_worked_on, '') THEN ? ELSE last_worked_on END,
          follow_up_on = CASE WHEN ? <> '' AND (COALESCE(last_worked_on, '') = '' OR (? <> '' AND ? >= last_worked_on)) THEN ? ELSE follow_up_on END,
          priority = CASE WHEN state IN ('assigned','in_progress','completed') THEN priority ELSE ${PRIO_SQL} END,
          priority_base = CASE WHEN state IN ('assigned','in_progress','completed') THEN priority_base ELSE ? END,
          priority_reason = CASE WHEN state IN ('assigned','in_progress','completed') THEN priority_reason ELSE ${PRIO_REASON_SQL} END, state = ?, state_reason = COALESCE(?, state_reason),
          assigned_to = CASE WHEN ? = 1 THEN NULL ELSE assigned_to END, assigned_at = CASE WHEN ? = 1 THEN NULL ELSE assigned_at END,
          skipped_at = CASE WHEN ? = 1 THEN NULL ELSE skipped_at END, raw_json = ?, updated_at = ?,
          alt_key = CASE WHEN alt_key = '' OR ? = 1 THEN ? ELSE alt_key END, fp_key = CASE WHEN fp_key = '' THEN ? ELSE fp_key END WHERE id = ?`).bind(
          location_id || null, bid, keepNo ? "" : vals.claim_no, keepNo ? "" : vals.claim_no, vals.account_no, vals.account_no, vals.patient, vals.patient, vals.payer, vals.payer,
          vals.dos, vals.dos, vals.cpt, vals.cpt, vals.provider, vals.provider, vals.billed, vals.balance, vals.lines, vals.lines_json, vals.age_days, vals.bucket, vals.tier, vals.status_class,
          vals.file_status, vals.file_sub_status, vals.file_action, vals.file_comments, vals.file_comments, vals.file_bucket,
          kind, kind, lastWorked, lastWorked, lastWorked, followUp, lastWorked, lastWorked, followUp, ...prioArgs(vals.priority), vals.priority, vals.priority_reason, vals.priority_reason, newState, reason,
          clearAssign, clearAssign, clearAssign, vals.raw_json, now, gotNo, keepNo ? "" : c._alt, c._fp, ex.id));
    }
    if (stmts.length) await batchAll(env, stmts, 40);
    await run(env, `UPDATE batches SET inserted = inserted + ?, updated = updated + ?, reopened = reopened + ?, closed = closed + ?, excluded = excluded + ?, skipped = skipped + ?,
        rows_read = CASE WHEN ? > 0 THEN ? ELSE rows_read END, summary_json = CASE WHEN ? = 1 THEN ? ELSE summary_json END WHERE id = ?`,
      counts.inserted, counts.updated, counts.reopened, counts.closed, counts.excluded, counts.skipped,
      Math.round(num(rows_read, 0)), Math.round(num(rows_read, 0)), final ? 1 : 0, str(JSON.stringify(summary || {}), 20000), bid);
    // An empty file (headers only, or every row skipped) does not count as the month's inventory.
    const loaded = final ? await one(env, "SELECT inserted + updated + reopened + closed + excluded AS n FROM batches WHERE id = ?", bid) : null;
    if (final && loaded && loaded.n > 0) { try { await monthendAuto(env, client.id, istISO(Date.now()).slice(0, 7), "inventory", user.name); await snapshotClients(env); await setSetting(env, "snap_at", Date.now()); } catch (e) {} }
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
  /* Merge claims that are really the same claim (same normalised claim number, or same patient + DOS and payer with no
     conflicting claim number; a made-up BR-... number is no claim number). The oldest row is kept; notes, work history and
     the biller move onto it, and it takes the real claim number when it only had a made-up one. */
  "inventory.dedupe": async ({ env, payload }) => {
    const client = await one(env, "SELECT id FROM clients WHERE id = ?", payload.client_id);
    if (!client) throw bad("Pick a client.");
    await backfillKeys(env);
    const rows = await all(env, `SELECT id, claim_no, payer, alt_key, fp_key, created_at, state, assigned_to, assigned_at, touches, worked_before, inventory_kind, last_worked_on, follow_up_on,
        last_status_code, last_action_code, last_sub_status, last_bucket, last_effective, last_note_action, last_note, last_worked_by FROM claims WHERE client_id = ? ORDER BY created_at`, client.id);
    const numOf = (r) => (isGeneratedNo(r) ? "" : r.alt_key);
    // the same claim number written differently
    const groups = new Map();
    for (const r of rows) { const k = numOf(r); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    // the same patient + DOS and payer (a claim with no payer goes with the others when they all have one payer): only when no
    // two members have different claim numbers
    const fpGroups = new Map();
    for (const r of rows) if (r.fp_key) { if (!fpGroups.has(r.fp_key)) fpGroups.set(r.fp_key, []); fpGroups.get(r.fp_key).push(r); }
    const byPayer = (list) => {
      const m = new Map(); for (const r of list) { const k = normText(r.payer); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      const named = [...m.keys()].filter(Boolean);
      if (named.length === 1 && m.has("")) { m.get(named[0]).push(...m.get("")); m.delete(""); }
      return [...m.values()];
    };
    const merged = []; const seen = new Set();
    const consider = (list) => {
      const alts = new Set(list.map(numOf).filter(Boolean));
      if (list.length < 2 || alts.size > 1) return;
      const fresh = list.filter((r) => !seen.has(r.id)); if (fresh.length < 2) return;
      fresh.forEach((r) => seen.add(r.id));
      const keep = [...fresh].sort((a, b) => (b.touches - a.touches) || (a.created_at - b.created_at))[0];
      merged.push({ keep, others: fresh.filter((r) => r.id !== keep.id) });
    };
    groups.forEach(consider); fpGroups.forEach((list) => byPayer(list).forEach(consider));
    const total = merged.reduce((n, g) => n + g.others.length, 0);
    if (payload.dry_run) return { groups: merged.length, duplicates: total };
    const stmts = [];
    for (const g of merged) {
      const k = g.keep;
      // the claim kept had no number of its own: it takes the real one of the copy merged into it
      const real = numOf(k) ? null : g.others.find((o) => numOf(o));
      if (real) stmts.push(env.DB.prepare("UPDATE claims SET claim_no = ?, alt_key = ? WHERE id = ?").bind(real.claim_no, real.alt_key, k.id));
      for (const o of g.others) {
        stmts.push(env.DB.prepare("UPDATE notes SET claim_id = ? WHERE claim_id = ?").bind(k.id, o.id));
        stmts.push(env.DB.prepare("UPDATE attachments SET claim_id = ? WHERE claim_id = ?").bind(k.id, o.id));
        stmts.push(env.DB.prepare("UPDATE handoffs SET claim_id = ? WHERE claim_id = ?").bind(k.id, o.id));
        stmts.push(env.DB.prepare("UPDATE claim_events SET claim_id = ? WHERE claim_id = ?").bind(k.id, o.id));
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
    editableOr(user, b.client_id);
    if (b.undone_at) throw bad("This batch was already undone.");
    // Only claims nobody has touched go: never opened or worked, no notes, files or hand-offs, and not refreshed by a later file.
    // A claim that was only handed to a biller (the upload allocates by itself) is untouched until someone opens it.
    const UNTOUCHED = `first_batch_id = ? AND batch_id = ? AND touches = 0 AND state IN ('open','assigned','completed','closed','excluded')
      AND NOT EXISTS (SELECT 1 FROM claim_events e WHERE e.claim_id = claims.id AND e.kind = 'opened')
      AND id NOT IN (SELECT claim_id FROM attachments) AND id NOT IN (SELECT claim_id FROM notes) AND id NOT IN (SELECT claim_id FROM handoffs)`;
    const added = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE first_batch_id = ?", b.id);
    const gone = await all(env, `SELECT id, assigned_to FROM claims WHERE ${UNTOUCHED}`, b.id, b.id);
    let removed = 0;
    const off = new Map();   // how many claims left each biller's list
    for (const part of chunks(gone, 80)) {
      const ids = part.map((x) => x.id), qs = ids.map(() => "?").join(",");
      // the claims first (a claim opened this very moment stays, with its history), then the history of the ones that went
      const res = await batchAll(env, [env.DB.prepare(`DELETE FROM claims WHERE id IN (${qs}) AND ${UNTOUCHED}`).bind(...ids, b.id, b.id),
        env.DB.prepare(`DELETE FROM claim_events WHERE claim_id IN (${qs}) AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.id = claim_events.claim_id)`).bind(...ids)]);
      removed += changesOf(res[0]);
      const left = new Set((await all(env, `SELECT id FROM claims WHERE id IN (${qs})`, ...ids)).map((x) => x.id));
      for (const x of part) if (x.assigned_to && !left.has(x.id)) off.set(x.assigned_to, (off.get(x.assigned_to) || 0) + 1);
    }
    // the billers who had been given those claims are told (the bell), so a shorter list is no surprise
    if (off.size) {
      const cname = ((await one(env, "SELECT name FROM clients WHERE id = ?", b.client_id)) || {}).name || "";
      await batchAll(env, [...off.entries()].map(([uid, n]) => env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)")
        .bind(uuid(), uid, Date.now(), `${n} claim${n === 1 ? " was" : "s were"} taken off your list: the upload they came from was undone${cname ? " (" + cname + ")" : ""}.`, "queue", b.client_id)), 50);
    }
    // Claims this file refreshed: a state the file changed (closed, excluded, reopened) goes back, when nothing changed it since.
    let reverted = 0;
    const evs = await all(env, `SELECT e.claim_id, e.data_json, c.state FROM claim_events e JOIN claims c ON c.id = e.claim_id
      WHERE e.kind = 'refreshed' AND e.at >= ? AND c.batch_id = ? AND e.data_json LIKE ?`, b.uploaded_at, b.id, `%"batch":"${b.id}"%`);
    const now = Date.now(), back = [];
    for (const e of evs) {
      const d = jsonObj(e.data_json), st = d.changes && d.changes.state;
      if (d.batch !== b.id || !Array.isArray(st) || e.state !== st[1] || !["open", "assigned", "completed", "closed", "excluded"].includes(st[0])) continue;
      back.push(env.DB.prepare("UPDATE claims SET state = ?, state_reason = 'Upload undone', updated_at = ? WHERE id = ? AND state = ?").bind(st[0], now, e.claim_id, st[1]));
      back.push(claimEvent(env, e.claim_id, user, "state", "Upload undone", { changes: { state: [st[1], st[0]] } }));
    }
    if (back.length) { const res = await batchAll(env, back, 40); reverted = res.filter((_, i) => i % 2 === 0).reduce((n, x) => n + changesOf(x), 0); }
    const refreshed = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE batch_id = ? AND first_batch_id <> ?", b.id, b.id);
    await run(env, "UPDATE batches SET undone_at = ? WHERE id = ?", now, b.id);
    // Month-end "inventory loaded" was ticked by itself: it goes when no other file with claims is left for that month.
    const month = istISO(b.uploaded_at).slice(0, 7);
    const other = (await all(env, "SELECT uploaded_at FROM batches WHERE client_id = ? AND id <> ? AND undone_at IS NULL AND inserted + updated + reopened + closed + excluded > 0", b.client_id, b.id)).some((x) => istISO(x.uploaded_at).slice(0, 7) === month);
    if (!other) await run(env, "DELETE FROM client_monthend WHERE client_id = ? AND month = ? AND step = 'inventory' AND auto = 1", b.client_id, month);
    return { removed, kept: Math.max(0, ((added && added.n) || 0) - removed), reverted, refreshed: (refreshed && refreshed.n) || 0 };
  },

  /* ---- claims (supervisor views) ---- */
  "claims.list": async ({ env, user, payload }) => {
    if (payload.stage && !INV_STAGE_SQL[payload.stage]) throw bad("Unknown stage.");
    const where = [], params = [];
    const ro = respOnly(user);
    if (ro) { where.push(`c.client_id IN (${ro.map(() => "?").join(",")})`); params.push(...ro); }
    if (user.scope) { where.push(`c.client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); params.push(...user.scope); }
    if (payload.client_id) { where.push("c.client_id = ?"); params.push(payload.client_id); }
    if (payload.location_id) { where.push("c.location_id = ?"); params.push(payload.location_id); }
    if (payload.state === "workable") where.push(`c.state IN ${WORKABLE}`);
    else if (payload.state) { where.push("c.state = ?"); params.push(str(payload.state, 20)); }
    for (const f of ["tier", "status_class", "payer", "inventory_kind"]) if (payload[f]) { where.push(`c.${f} = ?`); params.push(str(payload[f], 200)); }
    // the age bucket today (as each row shows its age), not the one saved at upload
    if (payload.bucket) { const ab = ageBucketArgs(str(payload.bucket, 20), isoDate(payload.today) || isoToday()); if (ab) { where.push("c." + IN_AGE_BUCKET); params.push(...ab); } else { where.push("c.bucket = ?"); params.push(str(payload.bucket, 200)); } }
    if (payload.assigned_to === "__none") where.push("c.assigned_to IS NULL");
    else if (payload.assigned_to) { where.push("c.assigned_to = ?"); params.push(str(payload.assigned_to, 60)); }
    if (payload.worked_before === true) where.push("c.worked_before = 1");
    if (payload.worked_before === false) where.push("c.worked_before = 0");
    if (payload.escalated) where.push("c.escalated = 1");
    if (payload.handoff_status) { where.push("c.handoff_status = ?"); params.push(str(payload.handoff_status, 30)); }
    // Posting / submission people see what is handed to their desk, and every claim of a client they are responsible for.
    { const dk = deskSql(user, "c.id"); const rc = [...(user.resp_clients || [])];
      if (dk && !ro) { if (rc.length) { where.push(`(${dk.replace(/^ AND /, "")} OR c.client_id IN (${rc.map(() => "?").join(",")}))`); params.push(...rc); } else where.push(dk.replace(/^ AND /, "")); } }
    if (payload.provider) { where.push("c.provider LIKE ?"); params.push("%" + str(payload.provider, 80).trim() + "%"); }
    if (payload.cpt) { where.push("c.cpt LIKE ?"); params.push("%" + str(payload.cpt, 40).trim() + "%"); }
    if (payload.payer_like) { where.push("c.payer LIKE ?"); params.push("%" + str(payload.payer_like, 80).trim() + "%"); }
    if (payload.min_balance != null && payload.min_balance !== "") { where.push("c.balance >= ?"); params.push(num(payload.min_balance, 0)); }
    // Turning 90 within N days: 91 - N to 90 days old today
    if (payload.turning90 != null && payload.turning90 !== "") { const n = Math.max(1, Math.min(30, Math.round(num(payload.turning90, 7)))); where.push(`${AGE_SQL("c.")} BETWEEN ? AND 90 AND c.balance > 0`); params.push(isoDate(payload.today) || isoToday(), 91 - n); }
    // Older than N days, by date of service (the age the over-90 target uses), else the file's age.
    if (payload.min_age != null && payload.min_age !== "") { where.push("(CASE WHEN c.dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN COALESCE(julianday(?) - julianday(substr(c.dos, 1, 10)), c.age_days) ELSE c.age_days END) >= ?"); params.push(isoDate(payload.today) || isoToday(), num(payload.min_age, 0)); }
    if (payload.max_balance != null && payload.max_balance !== "") { where.push("c.balance <= ?"); params.push(num(payload.max_balance, 0)); }
    if (payload.saag_status) { where.push("c.last_status_code = ?"); params.push(str(payload.saag_status, 60)); }
    if (payload.saag_bucket) { where.push("c.last_bucket = ?"); params.push(str(payload.saag_bucket, 20)); }
    if (payload.worked === "yes") where.push("c.last_status_code <> ''");
    if (payload.worked === "no") where.push("c.last_status_code = ''");
    if (payload.follow_up_due) { where.push("c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on <= ?"); params.push(isoDate(payload.today) || isoToday()); }
    // overdue: as Inventory status counts it, so a claim waiting on the client or at a desk is not in it
    if (payload.overdue) { where.push(`c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on < ? AND ${INV_NO_OPEN_HO}`); params.push(isoDate(payload.today) || isoToday()); }
    // stage: exactly one of Inventory status's stages, so a stage button opens the claims it counts
    if (payload.stage && INV_STAGE_SQL[payload.stage]) { where.push(INV_STAGE_SQL[payload.stage]); const t = isoDate(payload.today) || isoToday(); params.push(...(payload.stage === "overdue" || payload.stage === "due" ? [t] : payload.stage === "later" ? [t, t] : [])); }
    if (payload.q) { const q = "%" + str(payload.q, 80).trim() + "%"; where.push("(c.claim_no LIKE ? OR c.patient LIKE ? OR c.account_no LIKE ? OR c.payer LIKE ?)"); params.push(q, q, q, q); }
    const SORTS = { priority: "c.priority", balance: "c.balance", age_days: "(CASE WHEN c.dos GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN julianday('now') - julianday(substr(c.dos, 1, 10)) ELSE c.age_days END)", patient: "c.patient", payer: "c.payer", dos: "c.dos", updated_at: "c.updated_at", state: "c.state", assigned: "u.name", follow_up_on: "c.follow_up_on",
      claim_no: "c.claim_no", tier: "c.tier", status_class: "c.status_class", inventory_kind: "c.inventory_kind", provider: "c.provider", cpt: "c.cpt" };
    const sort = SORTS[payload.sort] || "c.priority";
    const dir = payload.dir === "asc" ? "ASC" : "DESC";
    const size = Math.max(10, Math.min(500, Math.round(num(payload.page_size, 50))));
    // a whole page number in a sane range, so the OFFSET below is always a whole number
    const page = Math.max(1, Math.min(1000000, Math.round(num(payload.page, 1))));
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt FROM claims c ${w}`, ...params)) || { n: 0, amt: 0 };
    const rows = await all(env, `SELECT c.id, c.client_id, c.location_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.cpt, c.provider, c.balance, c.billed, c.lines, c.age_days, c.bucket, c.tier,
        c.status_class, c.file_status, c.file_sub_status, c.inventory_kind, c.worked_before, c.last_worked_on, c.follow_up_on, c.priority, c.priority_reason, c.priority_set, c.priority_set_label, c.state, c.state_reason,
        c.assigned_to, c.assigned_at, c.completed_at, c.skips, c.escalated, c.touches, c.last_status_code, c.last_action_code, c.last_sub_status, c.last_bucket, c.last_effective, c.last_note_action,
        c.last_note, c.updated_at, c.handoff_status, u.name AS assigned_name, l.name AS location_name
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
    // desk people: values from the claims sent to their desk (and the clients they are responsible for), as Claims lists them
    if (deskOf(user)) { const rc = [...(user.resp_clients || [])]; where.push(`(${deskSql(user, "id").replace(/^ AND /, "")}${rc.length ? ` OR client_id IN (${rc.map(() => "?").join(",")})` : ""})`); params.push(...rc); }
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
    const ro = respOnly(user);
    if (ro) { where.push(`client_id IN (${ro.map(() => "?").join(",")})`); params.push(...ro); }
    if (user.scope) { where.push(`client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); params.push(...user.scope); }
    // desk people: the claims sent to their desk (and the clients they are responsible for), as Claims lists them (one "id IN" clause,
    // as the queries below put "c." in front of each clause)
    if (deskOf(user) && !ro) { const rc = [...(user.resp_clients || [])], dd = deskDepts(user);
      where.push(`id IN (SELECT h.claim_id FROM handoffs h WHERE h.dept IN (${dd.map(() => "?").join(",")})${rc.length ? ` UNION SELECT k.id FROM claims k WHERE k.client_id IN (${rc.map(() => "?").join(",")})` : ""})`); params.push(...dd, ...rc); }
    // Dashboard date range: only claims with activity in the window (loaded, refreshed, worked or closed then).
    if (payload.from_ms != null || payload.to_ms != null) { where.push("updated_at BETWEEN ? AND ?"); params.push(num(payload.from_ms, 0), num(payload.to_ms, Date.now())); }
    if (payload.client_id) { where.push("client_id = ?"); params.push(payload.client_id); }
    if (payload.location_id) { where.push("location_id = ?"); params.push(payload.location_id); }
    // A manager who picked a team lead on the Dashboard: that team lead's clients.
    if (payload.lead_id) { const lc = await leadClientIds(env, user, payload.lead_id); if (lc) { where.push(`client_id IN (${lc.length ? lc.map(() => "?").join(",") : "NULL"})`); params.push(...lc); } }
    // Dashboard cross-filters: click a bar and every other number is recomputed for that slice.
    const today = isoDate(payload.today) || isoToday();
    for (const f of ["tier", "status_class", "payer", "inventory_kind", "assigned_to"]) if (payload[f]) { where.push(`${f} = ?`); params.push(str(payload[f], 200)); }
    // the age bucket clicked: by the claim's age today, as the By age bars below group it
    if (payload.bucket) { const ab = ageBucketArgs(str(payload.bucket, 20), today); if (ab) { where.push(IN_AGE_BUCKET); params.push(...ab); } else { where.push("bucket = ?"); params.push(str(payload.bucket, 200)); } }
    if (payload.saag_status) { where.push("last_status_code = ?"); params.push(str(payload.saag_status, 60)); }
    if (payload.saag_bucket) { where.push("last_bucket = ?"); params.push(str(payload.saag_bucket, 20)); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const ww = (where.length ? w + " AND " : "WHERE ") + `state IN ${WORKABLE}`;
    const [states, tiers, buckets, classes, payers, kinds, users, due, escalated] = await Promise.all([
      all(env, `SELECT state, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${w} GROUP BY state`, ...params),
      all(env, `SELECT tier, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY tier`, ...params),
      all(env, `SELECT ${AGE_BUCKET_SQL("age")} AS bucket, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM (SELECT ${AGE_SQL()} AS age, bucket, balance FROM claims ${ww}) GROUP BY 1`, today, ...params),
      all(env, `SELECT status_class, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY status_class`, ...params),
      all(env, `SELECT payer, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY payer ORDER BY amt DESC LIMIT 12`, ...params),
      all(env, `SELECT inventory_kind, worked_before, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY inventory_kind, worked_before`, ...params),
      all(env, `SELECT c.assigned_to AS user_id, u.name, u.email, SUM(c.state = 'assigned') AS assigned, SUM(c.state = 'in_progress') AS in_progress,
          SUM(c.state = 'completed') AS completed, SUM(c.state = 'closed') AS closed,
          COALESCE(SUM(CASE WHEN c.state IN ('assigned','in_progress') THEN c.balance END),0) AS amt
        FROM claims c LEFT JOIN users u ON u.id = c.assigned_to ${(where.length ? "WHERE " + where.map((x) => "c." + x).join(" AND ") + " AND " : "WHERE ")} c.assigned_to IS NOT NULL GROUP BY c.assigned_to`, ...params),
      one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?`, ...params, today),
      one(env, `SELECT COUNT(*) AS n FROM claims ${(where.length ? w + " AND " : "WHERE ")} escalated = 1 AND state IN ${ESCALATION_STATES} AND NOT ${BOUNCE_WAITING_SQL("claims")}`, ...params),
    ]);
    // Follow-up date passed and nobody has touched the claim since: these need a biller again.
    const overdue = await one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} state = 'completed' AND follow_up_on <> '' AND follow_up_on < ? AND ${INV_NO_OPEN_HO.replace("c.id", "claims.id")}`, ...params, today);
    const [workBuckets, saagStatuses, byLocation] = await Promise.all([
      all(env, `SELECT last_bucket AS bucket, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} last_bucket <> '' GROUP BY last_bucket`, ...params),
      all(env, `SELECT last_status_code AS status, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} last_status_code <> '' GROUP BY last_status_code ORDER BY n DESC`, ...params),
      all(env, `SELECT c.client_id, cl.name AS client_name, c.location_id, l.name AS location_name,
          SUM(c.state = 'open') AS open_n, COALESCE(SUM(CASE WHEN c.state = 'open' THEN c.balance END),0) AS open_amt,
          SUM(c.state IN ('assigned','in_progress')) AS desk_n, COALESCE(SUM(CASE WHEN c.state IN ('assigned','in_progress') THEN c.balance END),0) AS desk_amt,
          SUM(c.state = 'completed') AS worked_n, COALESCE(SUM(CASE WHEN c.state = 'completed' THEN c.balance END),0) AS worked_amt,
          SUM(c.state = 'closed') AS closed_n, COALESCE(SUM(CASE WHEN c.state = 'closed' THEN c.balance END),0) AS closed_amt,
          SUM(c.state = 'in_process') AS process_n, COALESCE(SUM(CASE WHEN c.state = 'in_process' THEN c.balance END),0) AS process_amt,
          SUM(c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on < ? AND ${INV_NO_OPEN_HO}) AS overdue_n,
          COUNT(*) AS n, COALESCE(SUM(CASE WHEN c.state IN ${WORKABLE} THEN c.balance END),0) AS amt
        FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id ${(where.length ? "WHERE " + where.map((x) => "c." + x).join(" AND ") : "")}
        GROUP BY c.client_id, c.location_id ORDER BY cl.name, l.name`, today, ...params),
    ]);
    return { states, tiers, buckets, classes, payers, kinds, users, follow_ups_due: due, overdue, escalated: escalated ? escalated.n : 0, work_buckets: workBuckets, saag_statuses: saagStatuses, by_location: byLocation };
  },
  /* Every claim of one patient (same account number, or same patient name) at a client, with the last entry on each: one call covers them all. */
  "claims.byPatient": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, account_no, patient, assigned_to, last_worked_by FROM claims WHERE id = ?", str(payload.id, 60));
    if (!c) throw bad("Claim not found.");
    if (user.role === "supervisor" && !inScope(user, c.client_id)) throw outOfScope();
    // Everyone else, and desk people (team leads too), only from a claim they may open themselves (as claims.get).
    const dk = deskOf(user) && !(user.resp_clients && user.resp_clients.has(c.client_id));
    if ((user.role !== "supervisor" || deskOf(user)) && !(await canSeeClaim(env, user, c))) throw denied("This claim is not in your queue.");
    const rows = await all(env, `SELECT c.id, c.claim_no, c.account_no, c.patient, c.dos, c.cpt, c.payer, c.provider, c.balance, c.age_days, c.tier, c.state, c.assigned_to, u.name AS assigned_name, c.priority, c.follow_up_on,
        c.last_status_code, c.last_sub_status, c.last_action_code, c.last_bucket, c.last_note, c.last_worked_on, c.file_status, c.file_sub_status, l.name AS location_name
      FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN locations l ON l.id = c.location_id
      WHERE c.client_id = ? AND ${samePatientSql("c.")}${dk ? deskSql(user, "c.id") : ""} ORDER BY c.state IN ('open','assigned','in_progress','completed') DESC, c.priority DESC LIMIT 200`,
      c.client_id, ...samePatientArgs(c));
    return { patient: c.patient, account_no: c.account_no, rows: rows.map((r) => ({ ...r, mine: r.assigned_to === user.id })) };
  },
  "claims.eligible": async ({ env, payload }) => {
    if (!payload.client_id) throw bad("Pick a client.");
    const where = ["client_id = ?"], params = [payload.client_id];
    if (payload.location_id) { where.push("location_id = ?"); params.push(payload.location_id); }
    const today = isoDate(payload.today) || isoToday();
    where.push("((state = 'open') OR (state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?))"); params.push(today);
    const rows = await all(env, `SELECT id, location_id, claim_no, account_no, patient, payer, dos, cpt, balance, age_days, bucket, tier, status_class, inventory_kind, worked_before,
        last_worked_on, follow_up_on, priority, priority_reason, state, skips, escalated, touches, priority_set, priority_set_label, denial_date, handoff_status FROM claims WHERE ${where.join(" AND ")} ORDER BY priority DESC LIMIT 20000`, ...params);
    // The insurance's TFL / AFL go with each claim, so the score can count the days left.
    const lims = new Map((await all(env, "SELECT payer_key, tfl_days, afl_days FROM payer_limits WHERE client_id = ?", payload.client_id)).map((l) => [l.payer_key, l]));
    for (const r of rows) { const l = lims.get(payerKey(r.payer)); r.tfl_days = l ? l.tfl_days : null; r.afl_days = l ? l.afl_days : null; }
    return { claims: rows };
  },
  "claims.get": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT c.*, u.name AS assigned_name, wb.name AS last_worked_name, l.name AS location_name, cl.name AS client_name FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN users wb ON wb.id = c.last_worked_by LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    const see = await canSeeClaim(env, user, c);
    if (!see && !postedClosed(c)) throw denied("This claim is not in your queue.");
    return claimBundle(env, user, c, { viewOnly: !see });
  },
  /* Everything that happened to one claim, newest first: loads and refreshes, assignments, openings, work entries
     (SAAG, the note fields and what changed), notes, escalations and answers, skips, files and state changes. */
  "claims.timeline": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT c.*, u.name AS assigned_name FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (!(await canViewClaim(env, user, c))) throw denied("This claim is not in your queue.");
    const [notes, files, events] = await Promise.all([
      all(env, "SELECT * FROM notes WHERE claim_id = ? ORDER BY created_at DESC LIMIT 300", c.id),
      all(env, "SELECT id, user_name, name, type, size, created_at FROM attachments WHERE claim_id = ? ORDER BY created_at DESC LIMIT 200", c.id),
      all(env, "SELECT * FROM claim_events WHERE claim_id = ? ORDER BY at DESC LIMIT 500", c.id),
    ]);
    const out = [];
    // who last edited each entry (a team lead may edit a biller's entry), and the entries by id for the edit lines below
    const edNames = await namesOf(env, notes.map((n) => n.edited_by)), noteById = new Map(notes.map((n) => [n.id, n]));
    const workEv = events.filter((e) => e.kind === "worked");
    // A desk step (pending, in process, other, back, client, resume, rejected, sent to the client) saves a note and an event: show it once.
    const deskEv = events.filter((e) => /^handoff_(pending|inprocess|other|back|client|resume|rejected|client_sent)$/.test(e.kind));
    for (const n of notes) {
      if (n.kind === "note" && deskEv.some((e) => e.user_id === n.user_id && Math.abs(e.at - n.created_at) < 5000)) continue;
      const f = noteFields(n);
      if (n.kind === "work") {
        const ev = workEv.find((e) => e.user_id === n.user_id && Math.abs(e.at - n.created_at) < 5000);
        const d = ev ? jsonObj(ev.data_json) : {};
        out.push({ at: n.created_at, kind: "work", id: n.id, editable: !postedClosed(c) && (n.user_id === user.id || leadFor(user, c.client_id)), who: n.user_name, saag: { status: n.status || n.status_code, sub_status: n.sub_status, action: n.action || n.action_code, bucket: n.bucket, effective: n.effective },
          follow_up_on: n.follow_up_on, fields: f, comment: n.comment, changes: d.changes || {}, escalated: !!d.escalated, edited_at: n.edited_at, edited_by: (n.edited_by && edNames.get(n.edited_by)) || "" });
      } else if (n.kind === "skip") out.push({ at: n.created_at, kind: "skip", who: n.user_name, text: n.comment });
      else if (/^Escalation answered:/.test(n.comment || "")) out.push({ at: n.created_at, kind: "answer", who: n.user_name, text: n.comment.replace(/^Escalation answered:\s*/, "") });
      else out.push({ at: n.created_at, kind: "note", who: n.user_name, fields: f && f.findings != null ? f : null, text: n.comment });
    }
    for (const a of files) out.push({ at: a.created_at, kind: "file", who: a.user_name, file: { id: a.id, name: a.name, size: a.size, type: a.type } });
    for (const e of events) if (e.kind !== "worked") { const d = jsonObj(e.data_json);
      // each edit of an entry is a line of its own: who edited it, when, and which entry (the entry itself shows its latest text)
      if (e.kind === "edited") { const n = noteById.get(d.note_id); out.push({ at: e.at, kind: "edited", who: e.user_name, text: "", changes: {}, data: { note_id: d.note_id, entry_at: n ? n.created_at : null, entry_by: n ? n.user_name : "" } }); continue; }
      out.push({ at: e.at, kind: e.kind, who: e.user_name, text: e.text, changes: d.changes || {}, data: d }); }
    // Claims from before the event log: the first upload and the current assignment still show.
    const batch = c.first_batch_id ? await one(env, "SELECT b.file_name, b.kind, u.name AS by_name FROM batches b LEFT JOIN users u ON u.id = b.uploaded_by WHERE b.id = ?", c.first_batch_id) : null;
    out.push({ at: c.created_at, kind: "loaded", who: batch ? batch.by_name || "" : "", text: batch ? batch.file_name : "", data: { kind: c.inventory_kind, file_status: [c.file_status, c.file_sub_status].filter(Boolean).join(" · ") } });
    if (c.assigned_at && !events.some((e) => e.kind === "assigned")) out.push({ at: c.assigned_at, kind: "assigned", who: "", text: c.assigned_name || "", data: {}, changes: {} });
    if (c.escalated && c.escalated_at && !notes.some((n) => n.kind === "work" && Math.abs(n.created_at - c.escalated_at) < 5000)) out.push({ at: c.escalated_at, kind: "escalated", who: "", text: "" });
    out.sort((a, b) => b.at - a.at);
    return { claim: { id: c.id, claim_no: c.claim_no, patient: c.patient, payer: c.payer }, items: out };
  },
  /* A team lead raises or lowers claims, always with the reason: the reasons show what the automatic score misses, to improve allocation. */
  "claims.setPriority": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const level = ["top", "high", "low", ""].includes(payload.level) ? payload.level : null;
    if (!ids.length || level == null) throw bad("Pick claims and a priority.");
    const category = str(payload.category, 80).trim(), comment = str(payload.comment, 600).trim();
    if (!category) throw bad("Pick why you are changing the priority.");
    if (!commentOk(comment)) throw bad("Write a short comment on why, a few words at least.");
    const label = level ? `TL ${PRIORITY_LEVELS[level].label} (${category})` : "";
    const now = Date.now();
    let changed = 0;
    for (const part of chunks(ids, 80)) {
      const rows = await all(env, `SELECT id, priority, priority_base, priority_set, priority_reason FROM claims WHERE id IN (${part.map(() => "?").join(",")})${editScopeSql(user, "client_id")}`, ...part, ...editScopeArgs(user));
      const stmts = [];
      for (const r of rows) {
        const base = r.priority_set ? (r.priority_base != null ? r.priority_base : r.priority) : r.priority;
        const to = applyLevel(base, level);
        const autoReason = r.priority_set ? String(r.priority_reason || "").replace(/^TL [^·]*· /, "") : r.priority_reason;
        stmts.push(env.DB.prepare(`UPDATE claims SET priority = ?, priority_base = ?, priority_set = ?, priority_set_label = ?, priority_set_by = ?, priority_set_at = ?, priority_reason = ?, updated_at = ? WHERE id = ?`)
          .bind(to, base, level, label, level ? user.id : null, level ? now : null, label ? label + " · " + autoReason : autoReason, now, r.id));
        stmts.push(claimEvent(env, r.id, user, "priority", level ? PRIORITY_LEVELS[level].label : "Automatic", { from: r.priority, to, from_level: r.priority_set || "", level, category, comment, n: ids.length }));
        changed++;
      }
      if (stmts.length) await batchAll(env, stmts, 50);
    }
    return { changed };
  },
  /* Every priority change with its reason, for reviewing how allocation can be better. */
  "claims.priorityLog": async ({ env, user, payload }) => {
    const since = Date.now() - Math.min(365, Math.max(1, Math.round(num(payload.days, 90)))) * 86400000;
    const rows = await all(env, `SELECT e.at, e.user_name, e.text, e.data_json, c.id AS claim_id, c.claim_no, c.patient, c.payer, c.balance, c.age_days, c.state, cl.name AS client_name
      FROM claim_events e JOIN claims c ON c.id = e.claim_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE e.kind = 'priority' AND e.at >= ?${scopeSql(user, "c.client_id")} ORDER BY e.at DESC LIMIT 1000`, since, ...scopeArgs(user));
    const out = rows.map((r) => { const d = jsonObj(r.data_json); return { ...r, data_json: undefined, level: d.level || "", category: d.category || "", comment: d.comment || "", from: d.from, to: d.to }; });
    const byCat = {};
    for (const r of out) { const k = r.category || "Other"; byCat[k] = byCat[k] || { category: k, n: 0, top: 0, high: 0, low: 0, auto: 0, balance: 0 }; byCat[k].n++; byCat[k][r.level || "auto"]++; byCat[k].balance += r.balance || 0; }
    return { rows: out, categories: Object.values(byCat).sort((a, b) => b.n - a.n) };
  },
  "claims.setState": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const state = ["open", "excluded", "closed"].includes(payload.state) ? payload.state : null;
    if (!ids.length || !state) throw bad("Pick claims and a state.");
    const reason = str(payload.reason, 200) || (state === "open" ? "Reopened by supervisor" : (state === "closed" ? "Closed by supervisor" : "Excluded by supervisor"));
    const now = Date.now();
    let changed = 0;
    // A claim a desk still has (Payment posting, Submission or Rejections; waiting on the client too) keeps its state until the
    // desk finishes it or sends it back to AR: the desk never works a claim AR closed, and its next step never opens one again.
    // (The recheck after a submission is not a desk holding the claim: such a claim can be closed.)
    const atDesk = new Map();
    for (const part of chunks(ids, 80)) for (const r of await all(env, `SELECT h.claim_id, h.dept FROM handoffs h JOIN claims c ON c.id = h.claim_id
        WHERE h.claim_id IN (${part.map(() => "?").join(",")}) AND h.dept <> 'subcheck' AND h.status IN ('pending','assigned','client')${editScopeSql(user, "c.client_id")}`, ...part, ...editScopeArgs(user))) atDesk.set(r.claim_id, r.dept);
    const todo = ids.filter((id) => !atDesk.has(id));
    if (atDesk.size && !todo.length) { const verb = state === "closed" ? "closed" : state === "excluded" ? "excluded" : "reopened", d = DEPT_LABEL[[...atDesk.values()][0]];
      throw bad(atDesk.size === 1 ? `This claim is with ${d} now. It can be ${verb} once ${d} finishes it or sends it back to AR.`
        : `These ${atDesk.size} claims are with Payment Posting, Submission or Rejections now. They can be ${verb} once the desk finishes them or sends them back to AR.`); }
    for (const part of chunks(todo, 80)) { const rows = await all(env, `SELECT id, state FROM claims WHERE id IN (${part.map(() => "?").join(",")})${editScopeSql(user, "client_id")}`, ...part, ...editScopeArgs(user));
      const evs = rows.filter((r) => r.state !== state).map((r) => claimEvent(env, r.id, user, "state", reason, { changes: { state: [r.state, state] } })); if (evs.length) await batchAll(env, evs, 50); }
    for (const chunk of chunks(todo, 60)) {
      const r = await run(env, `UPDATE claims SET state = ?, state_reason = ?, assigned_to = CASE WHEN ? = 'open' THEN NULL ELSE assigned_to END, assigned_at = CASE WHEN ? = 'open' THEN NULL ELSE assigned_at END,
        skipped_at = NULL, escalated = CASE WHEN ? = 'open' THEN escalated ELSE 0 END, updated_at = ? WHERE id IN (${chunk.map(() => "?").join(",")})${editScopeSql(user, "client_id")}`, state, reason, state, state, state, now, ...chunk, ...editScopeArgs(user));
      changed += changesOf(r);
    }
    // at_desk: how many of the claims picked were left as they are because a desk has them
    return { changed, at_desk: atDesk.size };
  },

  /* ---- allocation ---- */
  "alloc.apply": async ({ env, user, payload }) => {
    const { client_id, location_id, strategy } = payload;
    const items = (Array.isArray(payload.assignments) ? payload.assignments : []).filter((a) => a && typeof a === "object");
    if (!client_id) throw bad("Pick a client.");
    if (!items.length) throw bad("Nothing to assign.");
    const userIds = [...new Set(items.map((a) => str(a.user_id, 60)))];
    const ok = new Set();
    for (const uid of userIds) if (await billerFor(env, uid, client_id)) ok.add(uid);
    if (!ok.size) throw bad("Pick active billers on this client. Team leads, and billers whose projects do not include this client, cannot be given its claims.");
    const today = isoDate(payload.today) || isoToday();
    const now = Date.now();
    const names = new Map((await all(env, `SELECT id, name FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, ...userIds)).map((u) => [u.id, u.name]));
    const before = new Map();
    for (const part of chunks(items.map((a) => str(a.id, 60)), 80)) (await all(env, `SELECT id, assigned_to, state, follow_up_on FROM claims WHERE id IN (${part.map(() => "?").join(",")}) AND client_id = ?`, ...part, client_id)).forEach((r) => before.set(r.id, r));
    const eligible = (a) => { const b = before.get(str(a.id, 60)); return b && (b.state === "open" || (b.state === "completed" && b.follow_up_on && b.follow_up_on <= today)); };
    const prevNames = new Map((await all(env, `SELECT id, name FROM users WHERE id IN (${[...new Set([...before.values()].map((b) => b.assigned_to).filter(Boolean)), ""].map(() => "?").join(",")})`, ...[...new Set([...before.values()].map((b) => b.assigned_to).filter(Boolean)), ""])).map((u) => [u.id, u.name]));
    const evs = items.filter((a) => ok.has(str(a.user_id, 60)) && eligible(a)).map((a) => { const b = before.get(str(a.id, 60)); return claimEvent(env, b.id, user, "assigned", names.get(str(a.user_id, 60)) || "", { from: b.assigned_to ? prevNames.get(b.assigned_to) || "" : "", via: str(strategy, 40) || "allocate" }); });
    const stmts = items.filter((a) => ok.has(str(a.user_id, 60))).map((a) =>
      env.DB.prepare(`UPDATE claims SET assigned_to = ?, assigned_at = ?, state = 'assigned', state_reason = '', priority = ${PRIO_SQL}, priority_base = ?, priority_reason = ${PRIO_REASON_SQL}, tier = CASE WHEN ? <> '' THEN ? ELSE tier END,
          age_days = COALESCE(?, age_days), bucket = CASE WHEN ? <> '' THEN ? ELSE bucket END, skipped_at = NULL, skips = 0, first_up = 0, updated_at = ?
        WHERE id = ? AND client_id = ? AND (state = 'open' OR (state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?))`)
        .bind(str(a.user_id, 60), now, ...prioArgs(num(a.priority, 0)), num(a.priority, 0), str(a.priority_reason, 300), str(a.priority_reason, 300), str(a.tier, 10), str(a.tier, 10), a.age_days == null ? null : Math.round(num(a.age_days, 0)),
          str(a.bucket, 20), str(a.bucket, 20), now, str(a.id, 60), client_id, today));
    const results = await batchAll(env, stmts, 50);
    const applied = results.reduce((s, r) => s + changesOf(r), 0);
    if (evs.length) await batchAll(env, evs, 50);
    if (applied) {
      const per = new Map(); for (const a of items) if (ok.has(str(a.user_id, 60)) && eligible(a)) per.set(str(a.user_id, 60), (per.get(str(a.user_id, 60)) || 0) + 1);
      const cname = ((await one(env, "SELECT name FROM clients WHERE id = ?", client_id)) || {}).name || "";
      await noticeAlloc(env, [...per.entries()], (n) => `${n} new claim${n === 1 ? " was" : "s were"} allocated to you by ${user.name || "your team lead"}${cname ? " (" + cname + ")" : ""}.`);
    }
    const id = uuid();
    await run(env, "INSERT INTO allocations (id, client_id, location_id, by_user, at, strategy, count, summary_json) VALUES (?,?,?,?,?,?,?,?)",
      id, client_id, location_id || null, user.id, now, str(strategy, 40), applied, str(JSON.stringify(payload.summary || {}), 20000));
    return { applied, allocation_id: id, skipped: items.length - applied };
  },
  "alloc.reassign": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const u = await one(env, "SELECT id, name FROM users WHERE id = ? AND active = 1", payload.user_id);
    if (!ids.length || !u) throw bad("Pick claims and an active team member.");
    // A biller on each claim's client (a team lead may also take claims themselves).
    if (u.id !== user.id) {
      const cids = new Set();
      for (const part of chunks(ids, 80)) (await all(env, `SELECT DISTINCT client_id FROM claims WHERE id IN (${part.map(() => "?").join(",")}) AND state IN ${WORKABLE}${editScopeSql(user, "client_id")}`, ...part, ...editScopeArgs(user))).forEach((r) => cids.add(r.client_id));
      for (const cid of cids) if (!(await billerFor(env, u.id, cid))) throw bad(`${u.name} cannot be given these claims: pick an active biller whose projects include the claim's client.`);
    }
    const now = Date.now();
    let changed = 0;
    const evs = [];
    for (const part of chunks(ids, 80)) for (const r of await all(env, `SELECT c.id, u.name AS prev FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id IN (${part.map(() => "?").join(",")}) AND c.state IN ${WORKABLE}${editScopeSql(user, "c.client_id")}`, ...part, ...editScopeArgs(user)))
      evs.push(claimEvent(env, r.id, user, "assigned", u.name, { from: r.prev || "", via: "reassign" }));
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET assigned_to = ?, assigned_at = ?, state = CASE WHEN state IN ('open','completed','in_progress') THEN 'assigned' ELSE state END, skipped_at = NULL, updated_at = ?
        WHERE id IN (${chunk.map(() => "?").join(",")}) AND state IN ${WORKABLE}${editScopeSql(user, "client_id")}`, u.id, now, now, ...chunk, ...editScopeArgs(user));
      changed += changesOf(r);
    }
    if (evs.length) await batchAll(env, evs, 50);
    if (changed && u.id !== user.id) await noticeAlloc(env, [[u.id, changed]], (n) => `${n} new claim${n === 1 ? " was" : "s were"} allocated to you by ${user.name || "your team lead"}.`);
    return { changed };
  },
  "alloc.unassign": async ({ env, user, payload }) => {
    const now = Date.now();
    const logOff = async (where, args) => { const rows = await all(env, `SELECT c.id, u.name AS prev FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE ${where}${editScopeSql(user, "c.client_id")}`, ...args, ...editScopeArgs(user)); if (rows.length) await batchAll(env, rows.map((r) => claimEvent(env, r.id, user, "unassigned", r.prev || "")), 50); };
    if (payload.user_id) {
      const where = ["assigned_to = ?", "state IN ('assigned','in_progress')"], params = [str(payload.user_id, 60)];
      if (payload.client_id) { where.push("client_id = ?"); params.push(payload.client_id); }
      await logOff(where.map((w) => "c." + w).join(" AND "), params);
      const r = await run(env, `UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', skipped_at = NULL, first_up = 0, updated_at = ? WHERE ${where.join(" AND ")}${editScopeSql(user, "client_id")}`, now, ...params, ...editScopeArgs(user));
      return { changed: changesOf(r) };
    }
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    if (!ids.length) throw bad("Pick claims to unassign.");
    let changed = 0;
    for (const part of chunks(ids, 80)) await logOff(`c.id IN (${part.map(() => "?").join(",")}) AND c.state IN ('assigned','in_progress')`, part);
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', skipped_at = NULL, first_up = 0, updated_at = ? WHERE id IN (${chunk.map(() => "?").join(",")}) AND state IN ('assigned','in_progress')${editScopeSql(user, "client_id")}`, now, ...chunk, ...editScopeArgs(user));
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
          ORDER BY CASE WHEN id = ? THEN 1 ELSE 0 END, first_up DESC, CASE WHEN skipped_at IS NULL THEN 0 ELSE 1 END, priority + ${TURN90_BOOST()} DESC, balance DESC, age_days DESC LIMIT 1`, user.id, today, skipId || "", today, today);
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
    const stmts = [env.DB.prepare("UPDATE claims SET state = 'assigned', started_at = NULL, skipped_at = CASE WHEN ? = 1 THEN ? ELSE skipped_at END, skips = skips + ?, first_up = CASE WHEN ? = 1 THEN 0 ELSE first_up END, updated_at = ? WHERE id = ?").bind(count, now, count, count, now, c.id)];
    // Every counted skip is a skip note (the reason is optional), so coaching and the reports count it. Back to my day is not a skip.
    if (count) stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'skip',?,?)").bind(uuid(), c.id, user.id, user.name, reason, now));
    else stmts.push(claimEvent(env, c.id, user, "returned", ""));
    await env.DB.batch(stmts);
    return { ok: true };
  },
  "queue.complete": async ({ env, user, payload, ctx }) => {
    const c = await one(env, "SELECT c.*, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (c.assigned_to !== user.id && !leadFor(user, c.client_id)) throw denied("This claim is not on your desk.");
    if (!["in_progress", "assigned", "completed"].includes(c.state)) throw bad("This claim is not open for work (it is " + c.state + ").");
    // Saved from My day (the claim open on the desk): a second save from another tab or a double click adds nothing.
    if (payload.desk && !(c.state === "in_progress" && c.assigned_to === user.id)) throw bad("This claim was already saved, or it is no longer open on your desk.");
    // A repeat of your own save (a stale tab): only a new entry asked for on purpose from the claim (rework) is added.
    if (!payload.rework && c.state === "completed" && c.last_worked_by === user.id) throw bad("You already saved this claim. Open it again to add another entry.");
    const saag = validateWork(payload);
    const fields = cleanNoteFields(payload.note, c);
    const lastWork = await one(env, "SELECT MAX(created_at) AS at FROM notes WHERE claim_id = ? AND kind = 'work'", c.id);
    await requireAttachment(env, c.id, saag, lastWork && lastWork.at);
    const today = isoDate(payload.today) || isoToday();
    const closed = isClosedWork(saag);
    // A follow-up date in the past would make the claim "overdue" the moment it is saved; the earliest is today.
    const wanted = isoDate(payload.follow_up_on);
    if (!closed && wanted && wanted > addDays(today, 365)) throw bad("Pick a follow-up date within a year from today.");
    // An action that sends the claim to Posting / Submission / Rejections (a person is set on the client) takes it off the
    // biller's list with no follow-up until the desk is done: the note and the answer carry no follow-up date then.
    const toDesk = !closed && !!((await entryDesk(env, c.client_id, saag)).people || {}).lead;
    const followUp = closed || toDesk ? "" : workingDayOnOrAfter((wanted && wanted >= today ? wanted : "") || addDays(today, followUpDays(saag.effective, c.client_follow_up_days)));
    const comment = composeNote(fields, saag, followUp);
    const escalate = payload.escalate ? 1 : 0;
    const now = Date.now();
    const targets = [c];
    const sibIds = (Array.isArray(payload.sibling_ids) ? payload.sibling_ids : []).map((x) => str(x, 60)).filter((x) => x && x !== c.id).slice(0, 50);
    if (sibIds.length) {
      const sibs = await all(env, `SELECT * FROM claims WHERE id IN (${sibIds.map(() => "?").join(",")}) AND client_id = ? AND assigned_to = ? AND state IN ('assigned','in_progress','completed') AND ${samePatientSql()}`, ...sibIds, c.client_id, user.id, ...samePatientArgs(c));
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
      stmts.push(env.DB.prepare(`INSERT INTO notes (id, claim_id, user_id, user_name, kind, status_code, action_code, comment, follow_up_on, created_at, status, sub_status, action, bucket, effective, note_action, fields_json, call_min)
          VALUES (?,?,?,?,'work',?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(uuid(), t.id, user.id, user.name, saag.status, saag.action, text, followUp, now, saag.status, saag.sub_status, saag.action, saag.bucket, saag.effective, "", JSON.stringify(f), t.id === c.id ? callMinOf(f) : null));
      stmts.push(env.DB.prepare(`UPDATE claims SET state = ?, state_reason = ?, started_at = NULL, completed_at = ?, last_status_code = ?, last_action_code = ?, last_sub_status = ?, last_bucket = ?, last_effective = ?, last_note_action = ?,
          last_note = ?, last_worked_by = ?, last_worked_on = ?, follow_up_on = ?, touches = touches + 1, worked_before = 1, escalated = ?, skipped_at = NULL, first_up = 0, updated_at = ?,
          escalated_at = CASE WHEN ? = 1 AND (escalated = 0 OR escalated_at IS NULL) THEN ? ELSE escalated_at END, escalated_by = CASE WHEN ? = 1 AND (escalated = 0 OR escalated_by IS NULL) THEN ? ELSE escalated_by END,
          escalation_answered_at = CASE WHEN escalated = 1 AND ? = 0 THEN ? ELSE escalation_answered_at END WHERE id = ?`)
        .bind(newState, reason, now, saag.status, saag.action, saag.sub_status, saag.bucket, saag.effective, "", text.slice(0, 600), user.id, today, followUp, escalate, now, escalate, now, escalate, user.id, escalate, now, t.id));
    }
    const lim = saveLimitsStmt(env, user, c.client_id, c.payer, fields, "note");
    if (lim) stmts.push(lim);
    const dd = denialDateStmt(env, c.id, fields);
    if (dd) stmts.push(dd);
    // Two saves of one claim at once (double click, two tabs): the first one wins, the other adds nothing.
    const lock = await run(env, "UPDATE claims SET updated_at = MAX(?, COALESCE(updated_at, 0) + 1) WHERE id = ? AND state = ? AND updated_at IS ?", now, c.id, c.state, c.updated_at);
    if (!changesOf(lock)) throw bad("This claim was just saved (in another tab, or by someone else). Open it again to see the latest.");
    await batchAll(env, stmts);
    // Payment posting / submission: send the claim to the department set on the client profile (the lead set on the client, or
    // the backup when the lead is no longer active; a rejected claim to the client's Rejections person first, when one is set).
    const handoff = await sendToDesk(env, user, c.client_id, saag, targets, now, user.id);
    // Copy the entry into the client's / location's OneDrive workbook in the background (when a link is set and Microsoft 365 is configured).
    if (!env.DEMO && env.MS_CLIENT_SECRET) { for (const t of targets) { const p = syncEntryToWorkbook(env, t.id, user, { ended_at: now, fields: t.id === c.id ? fields : { ...fields, call_start: "", call_end: "" } }); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p; } }
    return { completed: targets.length, closed, follow_up_on: followUp, state: newState, comment, handoff };
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
    const where = ["c.assigned_to = ?", "(c.state IN ('assigned','in_progress') OR (c.state IN ('completed','closed','in_process') AND c.completed_at >= ?))"];
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
        c.last_status_code, c.last_action_code, c.last_sub_status, c.last_bucket, c.last_effective, c.last_note_action, c.last_worked_on, c.handoff_status, cl.name AS client_name, l.name AS location_name
      FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE ${where.join(" AND ")}
      ORDER BY CASE c.state WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, c.first_up DESC, CASE WHEN c.skipped_at IS NULL THEN 0 ELSE 1 END, c.priority + ${TURN90_BOOST("c.")} DESC, c.balance DESC LIMIT 1000`, ...params, isoDate(payload.today) || istISO(Date.now()), isoDate(payload.today) || istISO(Date.now()));
    return { rows };
  },
  /* Edit a work note at any time (its author or a team lead). Each edit is kept in the claim history. */
  "notes.update": async ({ env, user, payload }) => {
    const n = await one(env, "SELECT * FROM notes WHERE id = ?", payload.id);
    if (!n || n.kind !== "work") throw bad("Note not found.");
    const c = await one(env, "SELECT c.*, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", n.claim_id);
    if (n.user_id !== user.id && !(c && leadFor(user, c.client_id))) throw denied("Only the author or a team lead can edit this note.");
    if (!c) throw bad("Claim not found.");
    if (deskOf(user) && !(await canSeeClaim(env, user, c))) throw denied("This claim is not in your queue.");
    if (postedClosed(c)) throw bad("Posting closed this claim (the payment is posted): its notes can no longer be edited.");
    const saag = validateWork(payload);
    const fields = cleanNoteFields(payload.note, c);
    if (!attachNeeded({ sub_status: n.sub_status, action: n.action })) {
      const prev = await one(env, "SELECT MAX(created_at) AS at FROM notes WHERE claim_id = ? AND kind = 'work' AND created_at < ?", c.id, n.created_at);
      await requireAttachment(env, c.id, saag, prev && prev.at);
    }
    const today = isoDate(payload.today) || isoToday();
    const closed = isClosedWork(saag);
    const wantedFu = isoDate(payload.follow_up_on);
    // The claim follows its latest entry (unless it is on a biller's list or with a desk now).
    const latest = await one(env, "SELECT id FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC LIMIT 1", c.id);
    const sets = !!latest && latest.id === n.id && c.state !== "in_progress" && c.state !== "assigned" && c.state !== IN_PROCESS;
    // An entry edited into an action that goes to a desk (Need to Post / Posting Correction, a resubmission, a paper claim) sends
    // the claim there exactly as saving it that way the first time does: the hand-off to the client's person, In process for AR,
    // no follow-up date while the desk has it (and the entry's own follow-up when nobody is set for that desk).
    // A claim the team lead closed or excluded (or an upload closed) keeps its state, its reason and its follow-up through an edit:
    // only a claim this entry closed itself (reason "Closed: ...") opens again when the edit makes the entry a follow-up.
    const held = (c.state === "closed" && !/^Closed: /.test(c.state_reason || "")) || c.state === "excluded";
    const sends = sets && !held && !!handoffDeptOf(saag.action) && handoffDeptOf(saag.action) !== handoffDeptOf(n.action || n.action_code);
    const toDesk = sends && !closed && !!((await entryDesk(env, c.client_id, saag)).people || {}).lead;
    const autoFu = () => addDays(today, followUpDays(saag.effective, c.client_follow_up_days));
    const followUp = closed || toDesk ? "" : sends ? workingDayOnOrAfter((wantedFu && wantedFu >= today ? wantedFu : "") || autoFu())
      : ((wantedFu && wantedFu >= today ? wantedFu : "") || n.follow_up_on || autoFu());
    const comment = composeNote(fields, saag, followUp);
    const now = Date.now();
    const stmts = [env.DB.prepare(`UPDATE notes SET status_code = ?, action_code = ?, comment = ?, follow_up_on = ?, status = ?, sub_status = ?, action = ?, bucket = ?, effective = ?, note_action = ?, fields_json = ?, call_min = ?, edited_at = ?, edited_by = ? WHERE id = ?`)
      .bind(saag.status, saag.action, comment, followUp, saag.status, saag.sub_status, saag.action, saag.bucket, saag.effective, "", JSON.stringify(fields), callMinOf(fields), now, user.id, n.id)];
    if (sets) {
      const newState = held ? c.state : closed ? "closed" : (c.state === "closed" ? "completed" : c.state);
      stmts.push(env.DB.prepare(`UPDATE claims SET state = ?, state_reason = ?, last_status_code = ?, last_action_code = ?, last_sub_status = ?, last_bucket = ?, last_effective = ?, last_note_action = ?, last_note = ?, follow_up_on = ?, updated_at = ? WHERE id = ?`)
        .bind(newState, held ? c.state_reason : closed ? "Closed: " + saag.effective : "", saag.status, saag.action, saag.sub_status, saag.bucket, saag.effective, "", comment.slice(0, 600), held ? c.follow_up_on : followUp, now, c.id));
    }
    stmts.push(claimEvent(env, c.id, user, "edited", "", { note_id: n.id }));
    const lim = saveLimitsStmt(env, user, c.client_id, c.payer, fields, "note");
    if (lim) stmts.push(lim);
    const dd = denialDateStmt(env, c.id, fields);
    if (dd) stmts.push(dd);
    // Two edits at once that both send the claim to a desk (a double click, two tabs): the first one wins, as with a saved entry.
    if (sends && !changesOf(await run(env, "UPDATE claims SET updated_at = MAX(?, COALESCE(updated_at, 0) + 1) WHERE id = ? AND state = ? AND updated_at IS ?", now, c.id, c.state, c.updated_at)))
      throw bad("This claim was just saved (in another tab, or by someone else). Open it again to see the latest.");
    await env.DB.batch(stmts);
    // the AR biller of the hand-off is the person whose entry it is (a team lead may be the one editing it)
    const handoff = sends ? await sendToDesk(env, user, c.client_id, saag, [c], now, n.user_id) : null;
    return { ok: true, comment, closed, handoff };
  },
  "history.mine": async ({ env, user, payload }) => {
    const from = num(payload.from_ms, 0), to = num(payload.to_ms, Date.now());
    const rows = await all(env, `SELECT nt.id AS note_id, nt.kind, nt.status_code, nt.action_code, nt.comment, nt.follow_up_on, nt.created_at, nt.status, nt.sub_status, nt.action, nt.bucket, nt.effective, nt.note_action, nt.edited_at,
        c.id AS claim_id, c.claim_no, c.account_no, c.patient, c.payer, c.provider, c.cpt, c.dos, c.balance, c.state, c.tier, c.bucket AS age_bucket, cl.name AS client_name, l.name AS location_name
      FROM notes nt JOIN claims c ON c.id = nt.claim_id LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
      WHERE nt.user_id = ? AND nt.created_at BETWEEN ? AND ? ORDER BY nt.created_at DESC LIMIT 1000`, user.id, from, to);
    // Where each claim stands with Payment posting / Submission now (the latest hand-off), so the biller sees it the moment the desk acts.
    const ids = [...new Set(rows.map((x) => x.claim_id))];
    const latest = new Map();
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      for (const h of await all(env, `SELECT h.claim_id, h.dept, h.status, h.created_at, h.done_at, h.done_by_name, h.reason, u.name AS lead_name, a.name AS assigned_name FROM handoffs h
          LEFT JOIN users u ON u.id = h.lead_id LEFT JOIN users a ON a.id = h.assigned_to WHERE h.dept <> 'subcheck' AND h.claim_id IN (${part.map(() => "?").join(",")}) ORDER BY h.created_at`, ...part)) latest.set(h.claim_id, h);
    }
    for (const x of rows) { const h = latest.get(x.claim_id); x.handoff = h ? { dept: h.dept, label: DEPT_LABEL[h.dept], status: h.status, at: h.done_at || h.created_at, by: h.done_by_name || "", to: h.assigned_name || h.lead_name || "", reason: h.reason || "" } : null; }
    return { rows };
  },
  "notes.add": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, assigned_to, last_worked_by FROM claims WHERE id = ?", payload.claim_id);
    if (!c) throw bad("Claim not found.");
    if (!(await canSeeClaim(env, user, c))) throw denied("This claim is not in your queue.");
    // A note in the standard format (DOS, CLM#, DENIAL, SOURCE/REF, PRE CALL CHECK, RCA/FINDINGS, ACTION) without a SAAG entry; plain text still works.
    let comment, fields = null;
    if (payload.note) {
      const full = await one(env, "SELECT dos, claim_no, payer FROM claims WHERE id = ?", c.id);
      c.payer = full.payer;
      fields = cleanNoteFields(payload.note, full);
      if (!commentOk(fields.findings)) throw bad("Write what you found (RCA / findings), a few words at least.");
      if (fields.source === "Call" && !fields.ref) throw bad("A call needs its reference number (REF).");
      if (fields.source === "Call" && (!fields.call_start || !fields.call_end)) throw bad("Enter the call's start and end time.");
      comment = composeNote(fields, null, "");
    } else {
      comment = str(payload.comment, 4000).trim();
      if (!commentOk(comment)) throw bad("Write a few words.");
    }
    const now = Date.now(), id = uuid();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at, note_action, fields_json, call_min) VALUES (?,?,?,?,'note',?,?,?,?,?)").bind(id, c.id, user.id, user.name, comment, now, "", JSON.stringify(fields || {}), callMinOf(fields)),
      env.DB.prepare("UPDATE claims SET updated_at = ? WHERE id = ?").bind(now, c.id),
      ...[fields && saveLimitsStmt(env, user, c.client_id, c.payer, fields, "note"), denialDateStmt(env, c.id, fields)].filter(Boolean),
    ]);
    return { note: { id, claim_id: c.id, user_id: user.id, user_name: user.name, kind: "note", comment, created_at: now, fields } };
  },

  /* ---- attachments: files kept with a claim, next to its notes (EOBs, denial letters, portal screenshots) ---- */
  "attachments.add": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, assigned_to, last_worked_by, state, handoff_status FROM claims WHERE id = ?", payload.claim_id);
    if (!c) throw bad("Claim not found.");
    if (!(await canSeeClaim(env, user, c))) throw denied("This claim is not in your queue.");
    const name = str(payload.name, 200).replace(/[\\/\u0000-\u001f]/g, "_").trim();
    if (!name) throw bad("The file has no name.");
    const data = String(payload.data || "");
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw bad("The file could not be read. Try attaching it again.");
    const size = Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (size > ATTACH_MAX_BYTES) throw bad("Files can be up to " + ATTACH_MAX_BYTES / 1048576 + " MB.");
    // Stored as given only when it is a safe type to open; anything else (SVG, HTML, scripts) is kept as a plain download.
    const type0 = str(payload.type, 120).trim().toLowerCase();
    const type = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain|text\/csv|application\/(vnd\.[a-z0-9.+-]+|msword|zip)|message\/rfc822)$/.test(type0) ? type0 : "application/octet-stream";
    const parts = [];
    for (let i = 0; i < data.length; i += ATTACH_PART_CHARS) parts.push(data.slice(i, i + ATTACH_PART_CHARS));
    const now = Date.now(), id = uuid();
    // One part per statement keeps each request to D1 small.
    for (let i = 0; i < parts.length; i++) await run(env, "INSERT INTO attachment_parts (attachment_id, seq, data) VALUES (?,?,?)", id, i, parts[i]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attachments (id, claim_id, user_id, user_name, name, type, size, parts, created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, c.id, user.id, user.name, name, type, size, parts.length, now),
      env.DB.prepare("UPDATE claims SET updated_at = ? WHERE id = ?").bind(now, c.id),
    ]);
    return { attachment: { id, claim_id: c.id, user_id: user.id, user_name: user.name, name, type, size, created_at: now, deletable: !postedClosed(c) } };
  },
  "attachments.get": async ({ env, user, payload }) => {
    const a = await one(env, "SELECT * FROM attachments WHERE id = ?", payload.id);
    if (!a) throw bad("This file is no longer attached.");
    const c = await one(env, "SELECT id, client_id, assigned_to, last_worked_by, state, handoff_status FROM claims WHERE id = ?", a.claim_id);
    if (!c || !(await canViewClaim(env, user, c))) throw denied("This claim is not in your queue.");
    const parts = await all(env, "SELECT data FROM attachment_parts WHERE attachment_id = ? ORDER BY seq", a.id);
    return { name: a.name, type: a.type, size: a.size, data: parts.map((p) => p.data).join("") };
  },
  /* The person who attached a file can remove it for 24 hours; a team lead can remove it any time. */
  "attachments.delete": async ({ env, user, payload }) => {
    const a = await one(env, "SELECT * FROM attachments WHERE id = ?", payload.id);
    if (!a) throw bad("This file is no longer attached.");
    // both the posting lock (state, handoff_status: C-19) and who may see the claim (D-08) need these columns
    const ac = await one(env, "SELECT id, client_id, assigned_to, last_worked_by, state, handoff_status FROM claims WHERE id = ?", a.claim_id);
    if (deskOf(user) && !(ac && (await canSeeClaim(env, user, ac)))) throw denied("This claim is not in your queue.");
    if (!(ac && leadFor(user, ac.client_id)) && (a.user_id !== user.id || Date.now() - a.created_at > EDIT_WINDOW_MS)) throw denied("Only the person who attached it (within 24 hours) or a team lead can remove this file.");
    // a claim Posting closed is read only: the EOB and the proof its posting rests on stay with it (files can still be added)
    if (postedClosed(ac)) throw bad("Posting closed this claim (the payment is posted): its files can no longer be removed.");
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
  /* Team allocations: every claim on a biller's desk (or worked in the period), side by side with the latest entry on it in
     the period, so a team lead sees in one list what was allocated, what was done, and what is still waiting. */
  "reports.desk": async ({ env, user, payload }) => {
    const from = num(payload.from_ms, 0), to = num(payload.to_ms, Date.now());
    const where = [], args = [from, to];
    if (user.scope) { where.push(`c.client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); args.push(...user.scope); }
    if (payload.client_id) { where.push("c.client_id = ?"); args.push(str(payload.client_id, 60)); }
    if (payload.location_id) { where.push("c.location_id = ?"); args.push(str(payload.location_id, 60)); }
    if (payload.user_id) { where.push("(c.assigned_to = ? OR nt.user_id = ?)"); args.push(str(payload.user_id, 60), str(payload.user_id, 60)); }
    // worked = SAAG work entries; a skip is shown as skipped, and a plain note (a lead's comment) is not work
    const rows = await all(env, `WITH wk AS (SELECT claim_id, NULLIF(SUM(kind = 'work'), 0) AS n, SUM(kind = 'skip') AS skips, MAX(created_at) AS last_at FROM notes WHERE created_at BETWEEN ? AND ? AND kind IN ('work', 'skip') GROUP BY claim_id)
      SELECT c.id AS claim_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, c.age_days, c.tier, c.priority, c.state, c.follow_up_on, c.assigned_to, c.assigned_at,
        c.escalated, u.name AS assigned_name, cl.name AS client_name, l.name AS location_name,
        wk.n AS entries, wk.skips, wk.last_at, nt.user_id AS by_id, nt.user_name AS by_name, nt.kind, nt.status, nt.sub_status, nt.action, nt.bucket AS work_bucket, nt.comment, nt.follow_up_on AS next_follow_up
      FROM claims c LEFT JOIN wk ON wk.claim_id = c.id LEFT JOIN notes nt ON nt.claim_id = c.id AND nt.created_at = wk.last_at
        LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
      WHERE ((c.assigned_to IS NOT NULL AND c.state IN ('assigned', 'in_progress', 'completed')) OR wk.n IS NOT NULL OR wk.skips > 0)${where.length ? " AND " + where.join(" AND ") : ""}
      ORDER BY u.name, c.priority DESC LIMIT 5000`, ...args);
    // one line per claim (two entries at the same moment would repeat it)
    const seen = new Set();
    return { rows: rows.filter((r) => !seen.has(r.claim_id) && seen.add(r.claim_id)), today: istISO(Date.now()) };
  },
  /* ---- data for the reporting apps inside My day & reports (team leads and above) ----
     Production: one row per entry in the Production Conso layout (AR), or one row per completed posting / submission
     hand-off (Payment Posting, Submission), so Third Eye reads Brahmastra's work without anyone exporting a conso. */
  "reports.production": async ({ env, user, payload }) => {
    const scope = ["pp", "sub"].includes(payload.scope) ? payload.scope : "ar";
    // desk people: their own desk's production only (Quality, for their own work), never AR's entries
    if (deskDepts(user) && !deskDepts(user).includes(scope === "pp" ? "posting" : scope === "sub" ? "submission" : "ar")) throw denied("That is AR's work or another desk's. Your desk is " + DESK_NAME[deskOf(user)] + ".");
    const from = num(payload.from_ms, 0), to = num(payload.to_ms, Date.now());
    const people = await all(env, "SELECT id, name, emp_id, city, reports_to FROM users");
    const byId = new Map(people.map((p) => [p.id, p]));
    const person = (id, name) => { const p = byId.get(id) || { name: name || "" }; return { ...p, name: p.name || name || "", reports_to_name: (byId.get(p.reports_to) || {}).name || "" }; };
    const where = [], args = [];
    if (payload.client_id) { where.push("c.client_id = ?"); args.push(str(payload.client_id, 60)); }
    if (payload.location_id) { where.push("c.location_id = ?"); args.push(str(payload.location_id, 60)); }
    if (payload.user_id && scope === "ar") { where.push("nt.user_id = ?"); args.push(str(payload.user_id, 60)); }
    const extra = where.length ? " AND " + where.join(" AND ") : "";
    if (scope === "ar") {
      const notes = await all(env, `SELECT c.*, cl.name AS client_name, l.name AS location_name, nt.user_id, nt.user_name, nt.created_at AS worked_at, nt.comment, nt.status, nt.sub_status, nt.action,
          nt.bucket AS work_bucket, nt.fields_json FROM notes nt JOIN claims c ON c.id = nt.claim_id LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
        WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ?${extra}${scopeSql(user, "c.client_id")} ORDER BY nt.created_at LIMIT 60000`, from, to, ...args, ...scopeArgs(user));
      const iDos = WORKBOOK_HEADER.indexOf("DOS"), iWorked = WORKBOOK_HEADER.indexOf("Date Worked");
      const rows = notes.map((n, i) => {
        const row = productionRow({ ...n, last_note: n.comment, last_status_code: n.status, last_sub_status: n.sub_status, last_action_code: n.action, last_bucket: n.work_bucket },
          person(n.user_id, n.user_name), { ended_at: n.worked_at, fields: noteFields(n) });
        row[0] = i + 1; row[iDos] = n.dos || ""; row[iWorked] = istISO(n.worked_at);
        return row;
      });
      return { scope, header: WORKBOOK_HEADER, rows };
    }
    const dept = scope === "pp" ? "posting" : "submission";
    const hs = await all(env, `SELECT h.*, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.billed, c.balance${scope === "sub" ? ", c.raw_json" : ""}, cl.name AS client_name, l.name AS location_name
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
      WHERE h.dept = ? AND h.status = 'complete' AND h.done_at BETWEEN ? AND ?${extra}${scopeSql(user, "c.client_id")} ORDER BY h.done_at LIMIT 60000`, dept, from, to, ...args, ...scopeArgs(user));
    // what the desk person entered goes along, under the column names Third Eye reads (an amount not entered stays empty)
    const header = scope === "pp"
      ? ["Client", "Practice", "Team Lead", "Associate Name", "Emp ID", "Date Worked", "Claim No", "Patient Name", "Insurance", "DOS", "Billed Amount", "Check Number", "Check Date",
        "Allowed Amount", "Paid Amount", "Posted", "Other Adjustment", "Adjustment Reason", "Deductible", "Co-insurance", "Co-pay", "Patient Responsibility", "Write-off", "Comment"]
      : ["Client", "Practice", "Team Lead", "Associate Name", "Emp ID", "Date Worked", "Claim No", "Patient Name", "Insurance", "Service Date", "Billed Amount", "Status", "Submission Type", "Type", "Claim Type", "Comment"];
    const nv = (v) => (v == null || v === "" ? "" : Number(v));
    const rows = hs.map((h) => {
      const p = person(h.done_by, h.done_by_name), proof = jsonObj(h.proof_json);
      if (scope === "pp") {
        // patient responsibility: deductible + co-insurance + co-pay, as in the Payment posting file
        const pr = [proof.deductible, proof.coinsurance, proof.copay].some((v) => v != null && v !== "") ? Math.round(((Number(proof.deductible) || 0) + (Number(proof.coinsurance) || 0) + (Number(proof.copay) || 0)) * 100) / 100 : "";
        return [h.client_name || "", h.location_name || "", p.reports_to_name, p.name, p.emp_id || "", istISO(h.done_at), h.claim_no || "", h.patient || "", h.payer || "", h.dos || "", h.billed == null ? "" : h.billed, proof.ref || "",
          isoDate(proof.check_date) || "", nv(proof.allowed), nv(proof.amount), nv(proof.amount), nv(proof.adjustment), proof.adj_reason || "", nv(proof.deductible), nv(proof.coinsurance), nv(proof.copay), pr, nv(proof.writeoff), h.note || ""];
      }
      // Type left empty in the form is the Type in the client's inventory file; the claim type defaults to the one the AR biller's action says (the Submission file's rule)
      return [h.client_name || "", h.location_name || "", p.reports_to_name, p.name, p.emp_id || "", istISO(h.done_at), h.claim_no || "", h.patient || "", h.payer || "", h.dos || "", h.billed == null ? "" : h.billed, "Submitted", proof.mode || "",
        proof.type || rawPick(jsonObj(h.raw_json), "Type"), proof.claim_type || claimTypeOf(h.saag_action), [proof.ref ? "Batch / claim ID " + proof.ref : "", h.note].filter(Boolean).join(" · ")];
    });
    return { scope, header, rows };
  },
  /* Portfolio & SLA: every client in scope with Drishti's latest score (the Portfolio's SLA column). */
  "sla.summary": async ({ env, user, payload }) => {
    if (user.role !== "supervisor") throw denied("The SLA scorecard is for team leads and above.");
    const today = isoDate(payload.today) || istISO(Date.now());
    const ov = await drishtiOverview(env);
    const clients = (await all(env, "SELECT id, name FROM clients WHERE active = 1 ORDER BY name")).filter((c) => inScope(user, c.id));
    const sums = ov.state === "ok" ? drSummary(ov, clients, today) : new Map();
    if (sums.size) await drTickMonthEnd(env, sums);
    const rows = clients.map((c) => ({ client_id: c.id, client: c.name, ...(sums.get(c.id) || { period: null, matched: false }), matched: sums.has(c.id) }));
    const scored = rows.filter((x) => x.score != null);
    return { state: ov.state, stale: !!ov.stale, error: ov.error || "", at: ov.at, rows, totals: { avg: scored.length ? Math.round(scored.reduce((t, x) => t + x.score, 0) / scored.length) : null,
      bands: { ok: scored.filter((x) => x.band === "ok").length, warn: scored.filter((x) => x.band === "warn").length, miss: scored.filter((x) => x.band === "miss").length },
      red: scored.reduce((t, x) => t + x.counts.miss, 0), amber: scored.reduce((t, x) => t + x.counts.warn, 0),
      red_names: [...new Set(rows.flatMap((x) => (x.drags || []).filter((d) => d.status === "miss").map((d) => d.name)))].slice(0, 5) } };
  },
  /* One client's scorecard in full: the period picked (the latest month unless asked), every KPI with its value, standard,
     formula, status, where it comes from and the comment; the scopes; what pulls it down; the score by period. */
  "sla.scorecard": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (user.role !== "supervisor") throw denied("The SLA scorecard is for team leads and above.");
    if (!inScope(user, clientId)) throw outOfScope();
    const client = await one(env, "SELECT id, name FROM clients WHERE id = ?", clientId); if (!client) throw bad("Unknown client.");
    const today = isoDate(payload.today) || istISO(Date.now());
    const ov = await drishtiOverview(env);
    if (ov.state !== "ok") return { state: ov.state, error: ov.error || "", client: { id: client.id, name: client.name }, drishti: null };
    const { d, ambiguous } = drMatch(ov, client.name);
    if (!d) return { state: "unmatched", client: { id: client.id, name: client.name }, drishti: null, others: ov.clients.map((c) => c.name).slice(0, 50) };
    const done = d.periods.filter((p) => !p.range.to || p.range.to < today);
    const kind = ["month", "week", "latest", "custom", "day"].includes(payload.kind) ? payload.kind : "month";
    // a kind the client has no period of: the latest period of any kind, said so (fallback), never shown as if it were that kind
    let list = kind === "latest" ? done : done.filter((p) => p.kind === kind); const fallback = !list.length && done.length ? kind : ""; if (!list.length) list = done;
    // step by the period's id (two periods can end on the same day); the end date still works for old links
    const pid = str(payload.period_id, 120), want = isoDate(payload.to);
    const cur = (pid && list.find((p) => String(p.id) === pid)) || (want && list.find((p) => p.range.to === want)) || list[0];
    if (!cur) return { state: "no_period", client: { id: client.id, name: client.name }, drishti: { id: d.id, name: d.name, owner: d.owner }, periods: [] };
    // a period Drishti scored twice (the same dates) counts once: the newer one, or the one picked
    const sameAll = done.filter((p) => p.kind === cur.kind), dupOf = (p) => sameAll.find((q) => q !== p && q.range.from === p.range.from && q.range.to === p.range.to && (q === cur || (p !== cur && String(q.createdAt || "") > String(p.createdAt || ""))));
    const same = sameAll.filter((p) => !dupOf(p)), prev = same.find((p) => p !== cur && p.range.to < cur.range.from) || null;
    const sc = drScore(d, cur, prev);
    // each KPI's last month and its last 6 periods, for the change arrow and the KPI's own trend
    const hist = same.filter((p) => p.range.to <= cur.range.to).slice(0, 6).reverse().map((p) => ({ p, s: p === cur ? sc : drScore(d, p, null) }));
    const prevItems = prev ? new Map(drScore(d, prev, null).items.map((i) => [i.scope_key + "." + i.key, i])) : new Map();
    for (const it of sc.items) {
      const k = it.scope_key + "." + it.key, pv = prevItems.get(k);
      it.prev = pv ? { value: pv.value, shown: pv.shown, status: pv.status } : null;
      it.history = hist.map(({ p, s }) => { const x = s.items.find((i) => i.scope_key + "." + i.key === k); return { label: p.label, to: p.range.to, value: x ? x.value : null, shown: x ? x.shown : "", status: x ? x.status : null }; });
    }
    const trend = same.filter((p) => p.range.to <= cur.range.to).slice(0, 6).reverse().map((p) => ({ id: p.id, label: p.label, to: p.range.to, pct: drScore(d, p, null).pct }));
    const sources = []; for (const it of sc.items) { const k = it.source; const x = sources.find((y) => y.from === k); if (x) x.metrics.push(it.name); else sources.push({ from: k, metrics: [it.name] }); }
    const sums = drSummary(ov, [client], today); if (sums.size) await drTickMonthEnd(env, sums);
    return { state: "ok", client: { id: client.id, name: client.name }, drishti: { id: d.id, name: d.name, owner: d.owner }, ambiguous, fallback,
      periods: done.map((p) => ({ id: p.id, kind: p.kind, label: p.label, from: p.range.from, to: p.range.to })), kind: cur.kind,
      period: { id: cur.id, kind: cur.kind, label: cur.label, from: cur.range.from, to: cur.range.to, created_at: cur.createdAt, created_by: cur.createdBy, reports: cur.reports },
      prev: prev ? { id: prev.id, label: prev.label, from: prev.range.from, to: prev.range.to, pct: drScore(d, prev, null).pct } : null,
      score: sc.pct, band: sc.band, delta: sc.delta, counts: sc.counts, scored: sc.scored, kpi_pct: sc.kpi_pct, sla_pct: sc.sla_pct,
      scopes: sc.scopes.map((x) => ({ key: x.key, name: x.name, short: x.short, ok: x.ok, warn: x.warn, miss: x.miss, scored: x.scored, pct: x.pct, band: x.band, missing: x.missing || [], items: x.items.map((i) => ({ name: i.name, shown: i.shown, status: i.status })) })),
      items: sc.items, drags: sc.drags, strengths: sc.strengths, trend, sources, at: ov.at };
  },
  /* Beside the scorecard: the client's people from Shastra WFM and its escalations in the period (SLA threshold 0). */
  "sla.extras": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (user.role !== "supervisor") throw denied("The SLA scorecard is for team leads and above.");
    if (!inScope(user, clientId)) throw outOfScope();
    const today = isoDate(payload.today) || istISO(Date.now());
    const from = isoDate(payload.from) || today.slice(0, 8) + "01", to = isoDate(payload.to) || today;
    const w = (await clientWfm(env, [clientId])).get(clientId) || null;
    const feed = await getSetting(env, "wfm_projects", null);
    const ts = (await tatStats(env, [clientId], istDayStart(from), istDayEnd(to))).get(clientId);
    const cl = await one(env, "SELECT posting_tat_hours, submission_tat_hours FROM clients WHERE id = ?", clientId);
    const tat = ts ? { posting: { ...ts.posting, who: undefined, tat: tatHours(cl, "posting") }, submission: { ...ts.submission, who: undefined, tat: tatHours(cl, "submission") }, attention: { ...ts.attention, who: undefined, tat: ATTN_TAT_HOURS }, missed: ts.missed_list.slice(0, 50) } : null;
    return { wfm: w, wfm_ok: !!(feed && feed.ok), esc: await escSummary(env, clientId, from, to), tat, month: monthLabel(from.slice(0, 7)) };
  },
  /* The Claims tab's CSV in the Production Conso layout: one row per claim with its last entry (blank work columns when
     nobody has worked it yet). Same filters as the list. Every claim of the list: the page asks for it 500 at a time (page),
     so a big client's file is read in parts; without a page, all of them in one answer. */
  "reports.claimsProduction": async ({ env, user, payload }) => {
    const rows = []; let total = 0;
    const onePage = payload.page != null, first = Math.max(1, Math.round(num(payload.page, 1)));
    for (let page = first; page < first + (onePage ? 1 : 2000); page++) { const rr = await OPS["claims.list"]({ env, user, payload: { ...payload, page, page_size: 500 } }); rows.push(...rr.rows); total = rr.total; if ((first - 1) * 500 + rows.length >= rr.total || !rr.rows.length) break; }
    const people = await all(env, "SELECT id, name, emp_id, city, reports_to FROM users"), byId = new Map(people.map((p) => [p.id, p]));
    const person = (id) => { const p = byId.get(id) || { name: "" }; return { ...p, reports_to_name: (byId.get(p.reports_to) || {}).name || "" }; };
    const cl = new Map((await all(env, "SELECT id, name FROM clients")).map((c) => [c.id, c.name]));
    const workedBy = new Map();
    for (const part of chunks(rows.map((c) => c.id), 80)) (await all(env, `SELECT id, last_worked_by FROM claims WHERE id IN (${part.map(() => "?").join(",")})`, ...part)).forEach((x) => workedBy.set(x.id, x.last_worked_by));
    const iWorked = WORKBOOK_HEADER.indexOf("Date Worked"), iAssoc = WORKBOOK_HEADER.indexOf("Associate Name"), iEmp = WORKBOOK_HEADER.indexOf("Emp. ID"), iTl = WORKBOOK_HEADER.indexOf("Team Lead"), iRange = WORKBOOK_HEADER.indexOf("Date Range"), iWeek = WORKBOOK_HEADER.indexOf("Week"), iLoc = WORKBOOK_HEADER.indexOf("Location");
    const iDos = WORKBOOK_HEADER.indexOf("DOS");
    const out = rows.map((c, i) => {
      const worked = !!(c.last_status_code || c.last_worked_on), by = worked ? person(c.last_worked_by || workedBy.get(c.id)) : null;
      const row = productionRow({ ...c, client_name: c.client_name || cl.get(c.client_id) || "" }, by, { ended_at: worked && c.last_worked_on ? Date.parse(c.last_worked_on + "T12:00:00+05:30") : Date.now(), age_at: Date.now() });
      row[0] = (first - 1) * 500 + i + 1; if (!worked) { row[iWorked] = ""; row[iAssoc] = ""; row[iEmp] = ""; row[iTl] = ""; row[iRange] = ""; row[iWeek] = ""; row[iLoc] = ""; } else row[iWorked] = c.last_worked_on || "";
      // dates as dates (the page writes them mm/dd/yyyy in the CSV), as Entries' production rows give them; a CSV has no date format
      row[iDos] = c.dos || "";
      return row;
    });
    return { header: WORKBOOK_HEADER, rows: out, total, page: first };
  },
  /* Drishti without a second sign-in: Brahmastra mints Drishti's own session token for the signed-in team lead, so the
     Drishti page inside My day & reports opens already signed in. Needs the Worker secret DRISHTI_TOKEN_SECRET (the same
     value as TOKEN_SECRET in Drishti's Apps Script settings); Drishti's backend and its Google Sheet are not changed. */
  "reports.drishtiSession": async ({ env, user }) => {
    if (!env.DRISHTI_TOKEN_SECRET) throw new ApiError(503, "Drishti single sign-in is not switched on yet. Until it is, sign in on the Drishti page itself.");
    const api = env.DRISHTI_API || DRISHTI_API_DEFAULT;
    const call = async (body) => {
      let r; try { r = await fetchT(api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" }); }
      catch (e) { throw new ApiError(502, "Drishti's server did not answer. Try again in a minute."); }
      let j = null; try { j = await r.json(); } catch (e) {}
      if (!j) throw new ApiError(502, "Drishti's server sent an answer Brahmastra could not read.");
      if (!j.ok) throw new ApiError(j.code === "auth" ? 503 : 400, j.code === "auth" ? "Drishti did not accept Brahmastra's sign-in. The DRISHTI_TOKEN_SECRET does not match Drishti's TOKEN_SECRET." : "Drishti: " + (j.error || "it refused."));
      return j;
    };
    const admin = await drishtiToken(env, "admin", "admin");
    const adminEmail = String(((await call({ a: "me", t: admin })).user || {}).email || "").toLowerCase();
    // Brahmastra's admin opens Drishti as its Admin. Nobody else does, whatever email is on their profile.
    if (user.is_admin) return { token: admin, name: "Admin", role: "admin", created: false };
    // Everyone else gets the Drishti account of their own email, and only of an email they could not have put there themselves:
    // one from Purview Shastra, or set by the admin. An address typed in Brahmastra by the person or a team lead does not count.
    const me = await one(env, "SELECT email, email_missing, email_typed FROM users WHERE id = ?", user.id);
    const email = me && !me.email_missing ? String(me.email || "").toLowerCase() : "";
    if (!email) throw bad("Your account has no email address yet. Ask for it to be added in Purview Shastra.");
    if (me.email_typed === 1) throw denied("Your email address was added in Brahmastra, not in Purview Shastra, so it does not pick your Drishti account. Ask for it to be added in Purview Shastra.");
    if (email === adminEmail) throw denied("That email address belongs to Drishti's Admin. Only Brahmastra's admin opens Drishti as its Admin.");
    const find = async () => ((await call({ a: "users.list", t: admin })).users || []).find((u) => String(u.email || "").toLowerCase() === email);
    let du = await find(), created = false;
    if (!du) {
      // First time: create their Drishti account (as Drishti's own sign-up would), under the manager they report to in Brahmastra.
      const mgrs = (await call({ a: "managers.list", t: admin })).managers || [];
      const asManager = mgrs.find((m) => String(m.email || "").toLowerCase() === email);
      let managerId = "";
      if (!asManager) {
        let cur = await one(env, "SELECT reports_to FROM users WHERE id = ?", user.id);
        for (let i = 0; i < 6 && cur && cur.reports_to && !managerId; i++) {
          const up = await one(env, "SELECT id, email, email_missing, email_typed, reports_to FROM users WHERE id = ?", cur.reports_to);
          const m = up && !up.email_missing && up.email_typed !== 1 && mgrs.find((x) => String(x.email || "").toLowerCase() === String(up.email || "").toLowerCase());
          if (m) managerId = m.id; cur = up;
        }
        if (!managerId) throw bad("Nobody you report to in Brahmastra is a manager in Drishti yet, so Drishti cannot place you. Ask Drishti's Admin to add your manager on Drishti's People tab.");
      }
      const role = asManager ? "manager" : /\bsme\b/i.test(user.designation || "") ? "sme" : /team lead|\btl\b/i.test(user.designation || "") ? "tl" : "supervisor";
      await call({ a: "signup", email, name: user.name || email, role, managerId, password: randomHex(24) });
      du = await find(); created = true;
      if (!du) throw new ApiError(502, "Drishti created the account but did not list it. Try again.");
    }
    return { token: await drishtiToken(env, du.id, du.role), name: du.name, role: du.role, created };
  },
  /* Each client's team lead(s), by client name, for the Brahmastra Reports folders Third Eye and Drishti save to. */
  "reports.clientLeads": async ({ env, user }) => {
    const clients = await all(env, `SELECT id, name FROM clients WHERE active = 1${scopeSql(user, "id")} ORDER BY name`, ...scopeArgs(user));
    const leads = {};
    for (const c of clients) leads[c.name] = await clientTeamLeads(env, c.id, null);
    return { root: REPORTS_ROOT, leads };
  },
  /* The AR Inventory report, written straight into the client's SLA & KPI folder in the Purviewautomate OneDrive (under each
     of its team leads), so Drishti picks it from OneDrive like every other report. Brahmastra builds the file in the browser. */
  "reports.saveArInventory": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    const c = await one(env, `SELECT id, name FROM clients WHERE id = ?${scopeSql(user, "id")}`, clientId, ...scopeArgs(user));
    if (!c) throw bad("Pick the client.");
    const b64 = String(payload.file_b64 || "");
    if (!b64 || b64.length > 14_000_000) throw bad("The report is empty or too large.");
    const name = odName(str(payload.name, 160) || "AR Inventory report - " + c.name).replace(/\.xlsx$/i, "") + ".xlsx";
    const tok = await graphAppToken(env);
    const owner = encodeURIComponent(env.REPORTS_OWNER || REPORTS_OWNER_DEFAULT);
    const saved = [];
    for (const lead of await clientTeamLeads(env, c.id, null)) {
      const path = [REPORTS_ROOT, odName(lead), odName(c.name), "SLA & KPI", name];
      const at = "/users/" + owner + "/drive/root:/" + path.map(encodeURIComponent).join("/") + ":";
      const r = await fetchT("https://graph.microsoft.com/v1.0" + at + "/content?@microsoft.graph.conflictBehavior=replace", { method: "PUT",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: b64Bytes(b64) }, 60000);
      if (!r.ok) throw new ApiError(502, "OneDrive did not save " + name + " (" + r.status + ").");
      saved.push(path.slice(0, -1).join(" › "));
    }
    try { await monthendAuto(env, c.id, closingMonth(isoDate(payload.today) || isoToday()), "sla_inventory", user.name); } catch (e) {}
    return { name, folders: saved };
  },
  /* The AR inventory as it stands now (open, on desks and worked claims), in the columns Drishti's AR Inventory report reads. */
  "reports.arInventory": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    if (!clientId) throw bad("Pick the client.");
    if (!inScope(user, clientId)) throw outOfScope();
    const loc = payload.location_id ? " AND c.location_id = ?" : "", locArgs = payload.location_id ? [str(payload.location_id, 60)] : [];
    const rows = await all(env, `SELECT c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.cpt, c.provider, c.billed, c.balance, c.age_days, c.state, c.file_status, c.file_sub_status, c.file_action,
        c.last_status_code, c.last_sub_status, c.last_action_code, c.last_note, c.file_comments, c.last_worked_on, l.name AS location_name
      FROM claims c LEFT JOIN locations l ON l.id = c.location_id WHERE c.client_id = ? AND c.state IN ${WORKABLE}${loc} ORDER BY c.age_days DESC LIMIT 60000`, clientId, ...locArgs);
    const header = ["Claim ID", "Account No", "Patient Name", "Payer", "Date of Service", "CPT", "Provider", "Location", "Charges", "Balance", "Aging Bucket", "Status", "Sub Status", "Action", "Comment", "Last Worked"];
    const label = (age) => { const b = ageBucketLetter(age); return b ? b.replace(/^[A-G]: /, "").replace(" Days", "").replace(" plus", "+") : ""; };
    return { header, rows: rows.map((c) => [c.claim_no || "", c.account_no || "", c.patient || "", c.payer || "", c.dos || "", c.cpt || "", c.provider || "", c.location_name || "",
      c.billed == null ? "" : c.billed, Number(c.balance) || 0, label(c.age_days), c.last_status_code || c.file_status || "", c.last_sub_status || c.file_sub_status || "",
      c.last_action_code || c.file_action || "", c.last_note || c.file_comments || "", c.last_worked_on || ""]) };
  },
  "supervisor.productivity": async ({ env, user, payload }) => {
    const off = Math.round(num(payload.tz_offset_min, IST_MIN)) * 60;
    const rows = await all(env, `SELECT nt.user_id, nt.user_name, date((nt.created_at / 1000) + ?, 'unixepoch') AS day, COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt,
        SUM(c.state = 'closed') AS resolved FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ?${scopeSql(user, "c.client_id")} GROUP BY nt.user_id, day ORDER BY day DESC, n DESC`,
      off, num(payload.from_ms, 0), num(payload.to_ms, Date.now()), ...scopeArgs(user));
    return { rows };
  },
  /* Time on calls: the call minutes billers entered, by person and by payer, for the dashboard. */
  "supervisor.callTime": async ({ env, user, payload }) => {
    const where = ["nt.call_min IS NOT NULL", "nt.created_at BETWEEN ? AND ?"], args = [num(payload.from_ms, 0), num(payload.to_ms, Date.now())];
    if (payload.client_id) { where.push("c.client_id = ?"); args.push(str(payload.client_id, 60)); }
    if (payload.location_id) { where.push("c.location_id = ?"); args.push(str(payload.location_id, 60)); }
    const w = `FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE ${where.join(" AND ")}${scopeSql(user, "c.client_id")}`, a = [...args, ...scopeArgs(user)];
    const total = await one(env, `SELECT COUNT(*) AS calls, COALESCE(SUM(nt.call_min), 0) AS minutes, COUNT(DISTINCT nt.user_id) AS people ${w}`, ...a);
    const byUser = await all(env, `SELECT nt.user_id, nt.user_name, COUNT(*) AS calls, SUM(nt.call_min) AS minutes, MAX(nt.call_min) AS longest ${w} GROUP BY nt.user_id ORDER BY minutes DESC`, ...a);
    const byPayer = await all(env, `SELECT COALESCE(NULLIF(c.payer, ''), 'Unknown') AS payer, COUNT(*) AS calls, SUM(nt.call_min) AS minutes ${w} GROUP BY 1 ORDER BY minutes DESC LIMIT 15`, ...a);
    return { total, by_user: byUser, by_payer: byPayer };
  },
  "supervisor.allocations": async ({ env, user, payload }) => {
    const range = payload.from_ms != null || payload.to_ms != null ? [num(payload.from_ms, 0), num(payload.to_ms, Date.now())] : [];
    const tail = range.length ? " AND a.at BETWEEN ? AND ?" : "";
    const rows = payload.client_id
      ? await all(env, "SELECT a.*, u.name AS by_name FROM allocations a LEFT JOIN users u ON u.id = a.by_user WHERE a.client_id = ?" + tail + " ORDER BY a.at DESC LIMIT 50", payload.client_id, ...range)
      : await all(env, `SELECT a.*, u.name AS by_name, c.name AS client_name FROM allocations a LEFT JOIN users u ON u.id = a.by_user LEFT JOIN clients c ON c.id = a.client_id WHERE 1 = 1${scopeSql(user, "a.client_id")}${tail} ORDER BY a.at DESC LIMIT 50`, ...scopeArgs(user), ...range);
    return { rows: rows.map((r) => { let s = {}; try { s = JSON.parse(r.summary_json); } catch {} return { ...r, summary: s, summary_json: undefined }; }) };
  },

  /* ---- payment posting & submission: the departments' queue ---- */
  "handoffs.list": async ({ env, user, payload }) => {
    // Who sees what: the admin and all-project leads everything; others their own hand-offs (lead, backup, assignee) and their projects'.
    let vis = "1 = 1"; const vargs = [];
    if (!(user.is_admin || (user.role === "supervisor" && !user.scope))) {
      const or = ["h.lead_id = ?", "h.backup_id = ?", "h.assigned_to = ?"]; vargs.push(user.id, user.id, user.id);
      if (user.role === "supervisor" && user.scope && user.scope.length) { or.push(`h.client_id IN (${user.scope.map(() => "?").join(",")})`); vargs.push(...user.scope); }
      vis = "(" + or.join(" OR ") + ")";
    }
    const desk = user.is_admin ? null : userDesk(user);
    // a desk person asks only for their own desk's departments (a posting lead never lists Submission's hand-offs)
    const dept = ["posting", "submission", "subcheck", "rejection"].includes(payload.dept) && (!desk || DESK_DEPTS[desk].includes(payload.dept)) ? payload.dept : desk && desk !== "both" ? desk : "";
    // The Submission chip also shows the follow-up checks after submitting and the rejections.
    let base = vis + (dept === "submission" ? " AND h.dept IN ('submission','subcheck','rejection')" : dept ? " AND h.dept = ?" : ""); const bargs = [...vargs, ...(dept && dept !== "submission" ? [dept] : [])];
    // One client, and the dates a claim was sent to the desk (the day the AR biller saved the entry that sent it)
    const cid = str(payload.client_id, 60);
    if (cid) { base += " AND h.client_id = ?"; bargs.push(cid); }
    const sFrom = num(payload.from_ms, 0), sTo = num(payload.to_ms, 0);
    if (sFrom) { base += " AND h.created_at >= ?"; bargs.push(sFrom); }
    if (sTo) { base += " AND h.created_at <= ?"; bargs.push(sTo); }
    const now = Date.now(), month = now - 30 * 86400000;
    const view = str(payload.view, 20) || "open";
    // open: on the clock · mine: given to me · client: waiting on the client (the clock keeps running) · done: completed or rejected · assist: returned to AR
    // hide_client: Open without the claims waiting on the client (and the Past TAT count without them too)
    const hideClient = !!payload.hide_client && view !== "client";
    // the cards on top list exactly what they count: late = past the TAT and not on hold (waiting on the client included,
    // the clock keeps running, unless hidden); held = on hold (Can't close yet) until its expected close date
    const today = istISO(now), onDesk = hideClient ? "'pending','assigned'" : "'pending','assigned','client'";
    const heldSql = `EXISTS (SELECT 1 FROM tat_holds th WHERE th.kind = 'handoff' AND th.ref_id = h.id AND th.cleared_at IS NULL AND th.until >= '${today}')`;
    const vw = view === "mine" ? " AND h.status IN ('pending','assigned') AND h.assigned_to = ?" : view === "client" ? " AND h.status = 'client'" : view === "done" ? " AND h.status IN ('complete','rejected') AND h.done_at > ?"
      : view === "assist" ? " AND h.status IN ('assistance','back') AND h.done_at > ?" : view === "late" ? ` AND h.status IN (${onDesk}) AND h.due_at < ? AND NOT ${heldSql}`
      : view === "held" ? ` AND h.status IN ('pending','assigned','client') AND ${heldSql}` : hideClient ? " AND h.status IN ('pending','assigned')" : " AND (h.status IN ('pending','assigned') OR (h.status = 'client' AND h.chase_at <= ?))";
    const vwArgs = view === "mine" ? [user.id] : view === "done" || view === "assist" ? [month] : view === "late" ? [now] : view === "client" || view === "held" || hideClient ? [] : [now];
    const rows = await all(env, `SELECT h.*, c.claim_no, c.patient, c.payer, c.dos, c.balance, c.billed, c.cpt, c.last_note, c.last_status_code, c.last_sub_status, cl.name AS client_name, lo.name AS location_name, cl.posting_tat_hours AS cl_posting_tat, cl.submission_tat_hours AS cl_submission_tat, cl.subcheck_hours AS cl_subcheck_hours,
        (SELECT COUNT(*) FROM handoffs r WHERE r.claim_id = h.claim_id AND r.status IN ('back','assistance')) AS returns,
        a.name AS assigned_name, l.name AS lead_name, b.name AS backup_name
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = h.client_id LEFT JOIN locations lo ON lo.id = c.location_id
      LEFT JOIN users a ON a.id = h.assigned_to LEFT JOIN users l ON l.id = h.lead_id LEFT JOIN users b ON b.id = h.backup_id
      WHERE ${base}${vw} ORDER BY CASE WHEN h.dept = 'rejection' AND h.status IN ('pending','assigned') THEN 0 ELSE 1 END, CASE WHEN h.status IN ('pending','assigned') THEN h.due_at WHEN h.status = 'client' THEN h.paused_at ELSE -h.done_at END LIMIT 500`, ...bargs, ...vwArgs);
    // due soon and the time left are in working hours, as the TAT is (a task due Monday 02:00 is due soon on Friday 23:00)
    const soonCut = addWorkingHours(now, DUE_SOON_HOURS);
    const whLeft = (h) => { const st0 = h.dept === "subcheck" && h.available_at ? h.available_at : h.created_at;
      return { left_wh: Math.round((now <= h.due_at ? workingHoursBetween(now, h.due_at) : -workingHoursBetween(h.due_at, now)) * 10) / 10,
        used_pct: Math.max(0, Math.min(100, Math.round(100 * workingHoursBetween(st0, now) / Math.max(0.1, workingHoursBetween(st0, h.due_at))))) }; };
    // "Can't close yet": a task on hold (until its expected close date) is off Past TAT and the reminders; a team lead with edit
    // access to the client holds it or clears the hold, here in the tab
    const hm = new Map();
    for (const part of chunks(rows.map((r) => r.id), 80)) for (const x of await all(env, `SELECT id, ref_id, reason, note, until, by_name FROM tat_holds WHERE kind = 'handoff' AND cleared_at IS NULL AND ref_id IN (${part.map(() => "?").join(",")}) ORDER BY at`, ...part)) hm.set(x.ref_id, x);
    const out = rows.map((h) => { const open = ["pending", "assigned", "client"].includes(h.status), ho = open ? hm.get(h.id) : null, held = !!ho && ho.until >= today; return { ...h, proof: jsonObj(h.proof_json), proof_json: undefined, overdue: open && now > h.due_at && !held,
      ...(open ? whLeft(h) : {}),
      hold: ho ? { id: ho.id, reason: ho.reason, note: ho.note || "", until: ho.until, by: ho.by_name || "", active: held } : null,
      can_hold: user.role === "supervisor" && canEditClient(user, h.client_id),
      due_soon: open && !held && now <= h.due_at && h.due_at <= soonCut && !(h.dept === "subcheck" && h.available_at && now < h.available_at),
      chase: h.status === "client" && !!h.chase_at && now >= h.chase_at,
      can_assign: user.is_admin || h.lead_id === user.id || h.backup_id === user.id, can_close: user.is_admin || h.lead_id === user.id || h.backup_id === user.id || h.assigned_to === user.id,
      tat_hours: tatHours({ posting_tat_hours: h.cl_posting_tat, submission_tat_hours: h.cl_submission_tat }, h.dept), recheck_hours: subcheckHours({ subcheck_hours: h.cl_subcheck_hours }),
      cl_posting_tat: undefined, cl_submission_tat: undefined, cl_subcheck_hours: undefined }; });
    // The TAT shown on top: the clients' own (one number when they all agree), else each row carries its own.
    const tats = new Set(out.map((r) => r.tat_hours));
    if (!out.length && cid) { const cl = await one(env, "SELECT posting_tat_hours, submission_tat_hours FROM clients WHERE id = ?", cid); if (cl) tats.add(tatHours(cl, dept || "submission")); }
    // Open counts what the Open list shows: on the desk, plus the ones waiting on the client once it is time to chase them
    const st = await one(env, `SELECT SUM(CASE WHEN h.status IN ('pending','assigned')${hideClient ? "" : ` OR (h.status = 'client' AND h.chase_at <= ${now})`} THEN 1 ELSE 0 END) AS open_n, SUM(CASE WHEN h.status IN (${onDesk}) AND h.due_at < ? AND NOT ${heldSql} THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN h.status IN ('pending','assigned','client') AND ${heldSql} THEN 1 ELSE 0 END) AS held_n,
        SUM(CASE WHEN h.status = 'client' THEN 1 ELSE 0 END) AS client_n, SUM(CASE WHEN h.dept = 'rejection' AND h.status IN ('pending','assigned') THEN 1 ELSE 0 END) AS rejection_n,
        SUM(CASE WHEN h.status IN ('pending','assigned','client') AND h.due_at >= ${now} AND h.due_at <= ${addWorkingHours(now, DUE_SOON_HOURS)} AND NOT (h.dept = 'subcheck' AND COALESCE(h.available_at, 0) > ${now}) AND NOT ${heldSql} THEN 1 ELSE 0 END) AS due_soon_n,
        SUM(CASE WHEN h.dept = 'subcheck' AND h.status IN ('pending','assigned') AND COALESCE(h.available_at, 0) <= ${now} THEN 1 ELSE 0 END) AS recheck_now_n,
        SUM(CASE WHEN h.status = 'client' AND h.chase_at <= ${now} THEN 1 ELSE 0 END) AS chase_n,
        SUM(CASE WHEN h.status IN ('complete','assistance','rejected','back') AND h.done_at > ? THEN 1 ELSE 0 END) AS done_n, SUM(CASE WHEN h.status IN ('complete','assistance','rejected','back') AND h.done_at > ? AND h.done_at <= h.due_at THEN 1 ELSE 0 END) AS met,
        SUM(CASE WHEN h.status IN ('assistance','back') AND h.done_at > ? THEN 1 ELSE 0 END) AS assist_n FROM handoffs h WHERE ${base}`, now, month, month, month, ...bargs);
    // Who each hand-off can be given to, by client and desk ("<client id>|posting" or "|submission"): the rule handoffs.assign checks
    const assignees = {};
    if (out.some((r) => r.can_assign && (r.status === "pending" || r.status === "assigned"))) {
      const team = await deskTeam(env);
      for (const r of out) { const k = r.client_id + "|" + (r.dept === "posting" ? "posting" : "submission");
        if (r.can_assign && !assignees[k]) assignees[k] = team.filter((m) => onDeskFor(m, r.dept, r.client_id)).map((m) => ({ id: m.id, name: m.name })); }
    }
    return { rows: out, reasons: ASSIST_REASONS, reject_reasons: REJECT_REASONS, reject_codes: REJECT_CODES, tat_hours: tats.size === 1 ? [...tats][0] : HANDOFF_TAT_HOURS, tat_varies: tats.size > 1, due_soon_hours: DUE_SOON_HOURS, stats: st || {}, hold_reasons: TAT_HOLD_REASONS, assignees };
  },
  /* For the tab badge and the red reminder: open hand-offs this person answers for, and how many are past their TAT. */
  /* The Payment posting / Submission dashboard: what came in, what was done and how fast, by client, person and day. */
  "handoffs.dashboard": async ({ env, user, payload }) => {
    const desk = user.is_admin ? null : userDesk(user);
    const dept = ["posting", "submission", "both"].includes(payload.dept) ? payload.dept : desk || "both";
    const depts = DESK_DEPTS[dept];
    const from = num(payload.from_ms, 0), to = num(payload.to_ms, Date.now()), now = Date.now();
    const w = [`h.dept IN (${depts.map(() => "?").join(",")})`], a = [...depts];
    if (!(user.is_admin || (user.role === "supervisor" && !user.scope))) {
      const or = ["h.lead_id = ?", "h.backup_id = ?", "h.assigned_to = ?"]; a.push(user.id, user.id, user.id);
      if (user.role === "supervisor" && user.scope && user.scope.length) { or.push(`h.client_id IN (${user.scope.map(() => "?").join(",")})`); a.push(...user.scope); }
      w.push("(" + or.join(" OR ") + ")");
    }
    if (payload.client_id) { w.push("h.client_id = ?"); a.push(str(payload.client_id, 60)); }
    const W = w.join(" AND ");
    // What the desk received and finished is its own work: Payment posting, Submission and Rejections tasks. The recheck after a
    // submission is the same claim again (did the payer accept it?), not a second claim received and submitted, as in the month's
    // Submission TAT %. It still counts under Open now, Needs you now and the rejections by code.
    const work = "h.dept <> 'subcheck'";
    // Open now and past the TAT, by one rule in the card, By client, By person and Needs you now (the desk list's rule): still with
    // the desk, waiting on the client included (the clock keeps running); past the TAT only when not on hold (Can't close yet).
    const openNow = "h.status IN ('pending','assigned','client')";
    const held = `EXISTS (SELECT 1 FROM tat_holds th WHERE th.kind = 'handoff' AND th.ref_id = h.id AND th.cleared_at IS NULL AND th.until >= '${istISO(now)}')`;
    const done = `${work} AND h.status IN ('complete','assistance','rejected','back')`;
    const tot = await one(env, `SELECT SUM(CASE WHEN ${work} AND h.created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS received,
        SUM(CASE WHEN ${work} AND h.status = 'complete' AND h.done_at BETWEEN ${from} AND ${to} THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN ${done} AND h.done_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN ${done} AND h.done_at BETWEEN ? AND ? AND h.done_at <= h.due_at THEN 1 ELSE 0 END) AS met,
        SUM(CASE WHEN h.status IN ('assistance','back') AND h.done_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS assist, SUM(CASE WHEN h.status = 'rejected' AND h.done_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS rejected,
        AVG(CASE WHEN ${work} AND h.status = 'complete' AND h.done_at BETWEEN ? AND ? THEN (h.done_at - h.created_at) / 3600000.0 END) AS avg_hours,
        SUM(CASE WHEN ${openNow} THEN 1 ELSE 0 END) AS open_now, SUM(CASE WHEN ${openNow} AND h.due_at < ? AND NOT ${held} THEN 1 ELSE 0 END) AS overdue_now,
        SUM(CASE WHEN h.status = 'complete' AND h.done_at BETWEEN ? AND ? THEN c.balance ELSE 0 END) AS amount,
        SUM(CASE WHEN h.status = 'client' THEN 1 ELSE 0 END) AS client_now, SUM(CASE WHEN h.status = 'back' AND h.done_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS back
      FROM handoffs h JOIN claims c ON c.id = h.claim_id WHERE ${W}`, from, to, from, to, from, to, from, to, from, to, from, to, now, from, to, from, to, ...a);
    const byClient = await all(env, `SELECT cl.name AS client_name, SUM(CASE WHEN ${work} AND h.created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS received,
        SUM(CASE WHEN ${work} AND h.status = 'complete' AND h.done_at BETWEEN ${from} AND ${to} THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN ${done} AND h.done_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN ${done} AND h.done_at BETWEEN ? AND ? AND h.done_at <= h.due_at THEN 1 ELSE 0 END) AS met,
        SUM(CASE WHEN ${openNow} THEN 1 ELSE 0 END) AS open_now, SUM(CASE WHEN ${openNow} AND h.due_at < ? AND NOT ${held} THEN 1 ELSE 0 END) AS overdue_now
      FROM handoffs h LEFT JOIN clients cl ON cl.id = h.client_id WHERE ${W} GROUP BY h.client_id ORDER BY overdue_now DESC, open_now DESC, cl.name`, from, to, from, to, from, to, now, ...a);
    const byPerson = await all(env, `SELECT COALESCE(NULLIF(h.done_by_name, ''), u.name, 'Not assigned') AS name, SUM(CASE WHEN ${done} AND h.done_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN ${work} AND h.status = 'complete' AND h.done_at BETWEEN ${from} AND ${to} THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN ${done} AND h.done_at BETWEEN ? AND ? AND h.done_at <= h.due_at THEN 1 ELSE 0 END) AS met, SUM(CASE WHEN ${openNow} THEN 1 ELSE 0 END) AS open_now,
        AVG(CASE WHEN ${work} AND h.status = 'complete' AND h.done_at BETWEEN ? AND ? THEN (h.done_at - h.created_at) / 3600000.0 END) AS avg_hours
      FROM handoffs h LEFT JOIN users u ON u.id = COALESCE(h.assigned_to, h.lead_id) WHERE ${W} AND ${work} GROUP BY 1 HAVING done > 0 OR open_now > 0 ORDER BY done DESC, name`, from, to, from, to, from, to, ...a);
    // time to complete in working hours, as the TAT counts (a task sent Friday 18:00 and done Monday 10:00 took 16, not 64)
    const comp = await all(env, `SELECT COALESCE(NULLIF(h.done_by_name, ''), u.name, 'Not assigned') AS name, CASE WHEN h.dept = 'subcheck' AND h.available_at IS NOT NULL THEN h.available_at ELSE h.created_at END AS st, h.done_at
      FROM handoffs h LEFT JOIN users u ON u.id = COALESCE(h.assigned_to, h.lead_id) WHERE ${W} AND ${work} AND h.status = 'complete' AND h.done_at BETWEEN ? AND ? LIMIT 20000`, ...a, from, to);
    const whAvg = (xs) => (xs.length ? Math.round(xs.reduce((t, x) => t + workingHoursBetween(x.st, x.done_at), 0) / xs.length * 10) / 10 : null);
    if (tot) tot.avg_hours = whAvg(comp);
    for (const p of byPerson) p.avg_hours = whAvg(comp.filter((x) => x.name === p.name));
    const ev = await all(env, `SELECT h.created_at, h.done_at, h.status FROM handoffs h WHERE ${W} AND ${work} AND (h.created_at BETWEEN ? AND ? OR h.done_at BETWEEN ? AND ?) LIMIT 20000`, ...a, from, to, from, to);
    const day = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
    const days = {};
    for (const e of ev) {
      if (e.created_at >= from && e.created_at <= to) (days[day(e.created_at)] = days[day(e.created_at)] || { received: 0, done: 0 }).received++;
      if (e.done_at && e.done_at >= from && e.done_at <= to && e.status === "complete") (days[day(e.done_at)] = days[day(e.done_at)] || { received: 0, done: 0 }).done++;
    }
    // For the department's team lead: what needs them now (past or near the TAT, chase the client, claims returned 3+ times).
    const soonCut = addWorkingHours(now, DUE_SOON_HOURS);
    const attention = (await all(env, `SELECT h.id, h.claim_id, h.dept, h.status, h.due_at, h.chase_at, h.available_at, c.claim_no, c.patient, cl.name AS client_name, ${held} AS held,
        COALESCE(a.name, l.name) AS who, (SELECT COUNT(*) FROM handoffs r WHERE r.claim_id = h.claim_id AND r.status IN ('back','assistance')) AS returns
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = h.client_id LEFT JOIN users a ON a.id = h.assigned_to LEFT JOIN users l ON l.id = h.lead_id
      WHERE ${W} AND h.status IN ('pending','assigned','client') AND NOT (h.dept = 'subcheck' AND COALESCE(h.available_at, 0) > ?) ORDER BY h.due_at LIMIT 300`, ...a, now))
      // one on hold is not past (or near) the TAT until its expected date; it is still listed when the client must be chased or it keeps coming back
      .map((x) => ({ ...x, held: !!x.held, why: x.due_at < now && !x.held ? "past" : x.status === "client" && x.chase_at && x.chase_at <= now ? "chase" : x.returns >= BOUNCE_LIMIT ? "bounced" : x.due_at <= soonCut && !x.held ? "soon" : "" }))
      .filter((x) => x.why).slice(0, 60);
    // Why claims came back to AR, by reason and by the biller who sent them.
    const backReasons = await all(env, `SELECT h.reason, COUNT(*) AS n FROM handoffs h WHERE ${W} AND h.status IN ('back','assistance') AND h.done_at BETWEEN ? AND ? GROUP BY h.reason ORDER BY n DESC`, ...a, from, to);
    const backBillers = await all(env, `SELECT h.created_by_name AS biller, COUNT(*) AS n, GROUP_CONCAT(DISTINCT h.reason) AS reasons FROM handoffs h WHERE ${W} AND h.status IN ('back','assistance') AND h.done_at BETWEEN ? AND ?
      GROUP BY h.created_by_name ORDER BY n DESC LIMIT 20`, ...a, from, to);
    // Rejections by code: a rejected recheck (its reason) or a resubmitted rejection (its code), by code, client and the biller who first sent the claim.
    const rejRows = dept === "posting" ? [] : await all(env, `SELECT CASE WHEN h.dept = 'subcheck' THEN h.reason ELSE json_extract(h.proof_json, '$.code') END AS code, cl.name AS client_name,
        (SELECT f.created_by_name FROM handoffs f WHERE f.claim_id = h.claim_id AND f.dept IN ('submission','rejection') ORDER BY f.created_at LIMIT 1) AS biller
      FROM handoffs h LEFT JOIN clients cl ON cl.id = h.client_id
      WHERE ${W.replace(/h\.dept IN \([^)]*\)/, "h.dept IN ('subcheck','rejection')")} AND ((h.dept = 'subcheck' AND h.status = 'rejected') OR (h.dept = 'rejection' AND h.status = 'complete')) AND h.done_at BETWEEN ? AND ?`,
      ...a.slice(depts.length), from, to);
    const tally = (k) => Object.entries(rejRows.reduce((m, r) => { const v = r[k] || "Not given"; m[v] = (m[v] || 0) + 1; return m; }, {})).map(([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n).slice(0, 15);
    // The TAT in the heading: the clients' own (Posting or Submission TAT on the client profile), one number when they all agree.
    const tatCl = payload.client_id ? await all(env, "SELECT posting_tat_hours, submission_tat_hours FROM clients WHERE id = ?", str(payload.client_id, 60))
      : await all(env, `SELECT DISTINCT cl.posting_tat_hours, cl.submission_tat_hours FROM handoffs h JOIN clients cl ON cl.id = h.client_id WHERE ${W}`, ...a);
    const tats = new Set(tatCl.flatMap((cl) => (dept === "both" ? ["posting", "submission"] : [dept]).map((d) => tatHours(cl, d))));
    return { dept, totals: tot || {}, by_client: byClient, by_person: byPerson, by_day: Object.keys(days).sort().map((d) => ({ day: d, ...days[d] })), tat_hours: tats.size === 1 ? [...tats][0] : HANDOFF_TAT_HOURS, tat_varies: tats.size > 1,
      attention, due_soon_hours: DUE_SOON_HOURS, bounce_limit: BOUNCE_LIMIT, back_reasons: backReasons, back_billers: backBillers,
      rejections: { total: rejRows.length, by_code: tally("code"), by_client: tally("client_name"), by_biller: tally("biller") } };
  },
  "handoffs.count": async ({ env, user }) => {
    const nowc = Date.now();
    // a task on hold (Can't close yet, until its expected close date) is neither past TAT nor due soon here
    const held = `EXISTS (SELECT 1 FROM tat_holds th WHERE th.kind = 'handoff' AND th.ref_id = handoffs.id AND th.cleared_at IS NULL AND th.until >= '${istISO(nowc)}')`;
    const r = await one(env, `SELECT COUNT(*) AS n, SUM(CASE WHEN due_at < ? AND NOT ${held} THEN 1 ELSE 0 END) AS overdue, SUM(CASE WHEN due_at >= ? AND due_at <= ? AND NOT (dept = 'subcheck' AND COALESCE(available_at, 0) > ?) AND NOT ${held} THEN 1 ELSE 0 END) AS due_soon
      FROM handoffs WHERE status IN ('pending','assigned','client') AND (lead_id = ? OR backup_id = ? OR assigned_to = ?) AND NOT (dept = 'subcheck' AND COALESCE(available_at, 0) > ?)
        AND claim_id IN (SELECT id FROM claims)`, nowc, nowc, addWorkingHours(nowc, DUE_SOON_HOURS), nowc, user.id, user.id, user.id, nowc);
    const any = await one(env, "SELECT 1 AS x FROM handoffs WHERE lead_id = ? OR backup_id = ? OR assigned_to = ? LIMIT 1", user.id, user.id, user.id);
    // Which hand-offs this person handles: set on a client (Clients & locations), their department, or given to them
    const set = await one(env, `SELECT SUM(CASE WHEN posting_lead = ? OR posting_backup = ? THEN 1 ELSE 0 END) AS posting,
        SUM(CASE WHEN submission_lead = ? OR submission_backup = ? THEN 1 ELSE 0 END) AS submission, SUM(CASE WHEN submission_check_person = ? THEN 1 ELSE 0 END) AS subcheck,
        SUM(CASE WHEN rejection_lead = ? OR rejection_backup = ? THEN 1 ELSE 0 END) AS rejection FROM clients WHERE active = 1`,
      user.id, user.id, user.id, user.id, user.id, user.id, user.id);
    const got = await all(env, "SELECT DISTINCT dept FROM handoffs WHERE lead_id = ? OR backup_id = ? OR assigned_to = ?", user.id, user.id, user.id);
    const depts = new Set(got.map((x) => x.dept));
    for (const k of ["posting", "submission", "subcheck", "rejection"]) if (set && set[k]) depts.add(k);
    if (userDesk(user)) DESK_DEPTS[userDesk(user)].forEach((d) => depts.add(d));
    return { n: (r && r.n) || 0, overdue: (r && r.overdue) || 0, due_soon: (r && r.due_soon) || 0, involved: !!(any || depts.size), depts: [...depts], desk: user.is_admin ? null : userDesk(user) };
  },
  "handoffs.assign": async ({ env, user, payload }) => {
    const h = await one(env, "SELECT * FROM handoffs WHERE id = ?", payload.id);
    if (!h) throw bad("That hand-off was not found.");
    if (!["pending", "assigned"].includes(h.status)) throw bad("This hand-off is already closed.");
    if (!(user.is_admin || h.lead_id === user.id || h.backup_id === user.id)) throw denied("Only the department lead or backup assigns these.");
    const to = await one(env, "SELECT id, name FROM users WHERE id = ? AND active = 1", payload.user_id);
    if (!to) throw bad("Pick an active team member.");
    // Being given a hand-off opens its claim to that person and lets them close it: only someone of this desk who can work the
    // claim's client (the list the tab offers), the hand-off's own lead or backup, or the person assigning it (to themselves).
    if (!(to.id === user.id || to.id === h.lead_id || to.id === h.backup_id || (await deskTeam(env)).some((m) => m.id === to.id && onDeskFor(m, h.dept, h.client_id))))
      throw bad(`${to.name} cannot be given this hand-off: pick someone on ${DESK_NAME[h.dept === "posting" ? "posting" : "submission"]} who works this client.`);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE handoffs SET status = 'assigned', assigned_to = ?, assigned_at = ? WHERE id = ?").bind(to.id, now, h.id),
      claimEvent(env, h.claim_id, user, "handoff_assigned", to.name, { dept: h.dept }),
    ]);
    return { ok: true };
  },
  /* Complete (with proof) or Need assistance (with a reason): the same status then shows to the TL, the biller and the department. */
  "handoffs.close": async ({ env, user, payload, ctx }) => {
    const h = await one(env, "SELECT * FROM handoffs WHERE id = ?", payload.id);
    if (!h) throw bad("That hand-off was not found.");
    if (!["pending", "assigned", "client"].includes(h.status)) throw bad("This hand-off is already closed.");
    const c = await one(env, "SELECT * FROM claims WHERE id = ?", h.claim_id);
    const mine = user.is_admin || h.lead_id === user.id || h.backup_id === user.id || h.assigned_to === user.id;
    // After a resubmission the recheck (accepted or rejected again?) can also be marked by the biller who worked the claim,
    // the Submission and Rejections people of the client, and the client's AR team leads.
    if (!mine) {
      const recheck = h.dept === "subcheck" && ["complete", "rejected"].includes(payload.outcome);
      const cl0 = recheck ? await one(env, "SELECT submission_lead, submission_backup, rejection_lead, rejection_backup FROM clients WHERE id = ?", h.client_id) : null;
      const ok = recheck && (isRecheckBiller(user, h, c) || (cl0 && [cl0.submission_lead, cl0.submission_backup, cl0.rejection_lead, cl0.rejection_backup].includes(user.id)) || leadFor(user, h.client_id));
      if (!ok) throw denied("This hand-off is not yours.");
    }
    // The page says where the hand-off stood when the person chose (seen). If someone else has since moved it between the desk and
    // waiting on the client, the choice was made on an old screen: it is refused, so the first of two different choices wins.
    const seen = str(payload.seen, 20), side = (st) => (st === "client" ? "client" : "desk");
    if (["pending", "assigned", "client"].includes(seen) && side(seen) !== side(h.status))
      throw new ApiError(409, "This hand-off has changed since you opened it: " + (h.status === "client" ? "it is waiting on the client now" : "the client has answered and it is back on the desk") + ". See where it stands, then choose again.");
    // The recheck after a submission opens after the client's recheck time (48 working hours unless set lower): the point is to
    // check once the payer has had that time, so nothing is marked on it before then.
    if (h.dept === "subcheck" && h.available_at && Date.now() < h.available_at) {
      const o = istDate(h.available_at), p2 = (x) => String(x).padStart(2, "0");
      throw bad(`This recheck opens ${MONTHS_LONG[o.getUTCMonth()]} ${o.getUTCDate()}, ${p2(o.getUTCHours())}:${p2(o.getUTCMinutes())} IST, when the payer has had time to show the claim. Mark it then.`);
    }
    const pfx = HO_PREFIX[h.dept] || h.dept;
    // The four choices: completed, pending (still working, with a comment), need assistance from AR, need assistance from client.
    // ("assistance" is the older name for assistance from AR.)
    const outcome = payload.outcome === "assistance" ? "back" : payload.outcome;
    // A claim already closed (Posting posted it, AR or the team lead closed it) or excluded stays as it is: a desk step on it
    // afterwards (a recheck, a Rejections task) is kept on the hand-off and in the history, and never opens the claim again or
    // lifts the read-only lock of a claim Posting closed.
    const KEEP = " AND state NOT IN ('closed','excluded')", kept = c.state === "closed" || c.state === "excluded";
    // Back to AR: on the biller's desk today (or the pool when nobody has it).
    const backToAr = (status, extra = "") => env.DB.prepare(`UPDATE claims SET handoff_status = ?, state = CASE WHEN state IN ('completed','assigned','in_process') THEN (CASE WHEN assigned_to IS NOT NULL THEN 'assigned' ELSE 'open' END) ELSE state END,
        state_reason = '', follow_up_on = ?, skipped_at = NULL, first_up = 1${extra}, updated_at = ? WHERE id = ?${KEEP}`);
    const now = Date.now(), today = isoDate(payload.today) || isoToday();
    const note = str(payload.note, 2000).trim();
    const stmts = [];
    // The status change runs first, and only while the hand-off still stands as this request found it (on the desk, or waiting
    // on the client), so two choices at once cannot both go through: the first one wins, whatever the two choices are.
    const STILL = h.status === "client" ? "status = 'client'" : "status IN ('pending','assigned')";
    let guard = null, listed = false;
    if (outcome === "complete") {
      const p = payload.proof || {};
      // amounts: optional, a number when given (Paid is the "amount posted" the reports add up)
      const amt = (v, label) => { if (v === "" || v == null) return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, "")); if (!isFinite(n)) throw bad(label + " is not a number."); return Math.round(n * 100) / 100; };
      const txt = (v, n) => str(v, n).trim();
      let proof;
      if (h.dept === "posting") {
        const paid = amt(p.paid != null && p.paid !== "" ? p.paid : p.amount, "Paid");
        proof = { date: isoDate(p.date), ref: txt(p.ref, 80), amount: paid, paid, allowed: amt(p.allowed, "Allowed"), adjustment: amt(p.adjustment, "Adjustment"), adj_reason: txt(p.adj_reason, 60),
          deductible: amt(p.deductible, "Deductible"), coinsurance: amt(p.coinsurance, "Co-insurance"), copay: amt(p.copay, "Co-pay"), writeoff: amt(p.writeoff, "Write-off"),
          check_date: isoDate(p.check_date), pay_type: txt(p.pay_type, 40) };
        for (const k of ["allowed", "paid", "adjustment", "deductible", "coinsurance", "copay", "writeoff", "check_date", "pay_type", "adj_reason"]) if (proof[k] == null || proof[k] === "") delete proof[k];
        // the amounts must add up: Allowed = Paid + Deductible + Co-insurance + Co-pay + Adjustment (to the cent). Checked whenever the
        // allowed, the paid or a patient amount is entered; only the older "amount posted" alone (an earlier form) is taken as before.
        if (["allowed", "paid", "deductible", "coinsurance", "copay"].some((k) => p[k] !== "" && p[k] != null)) {
          if (proof.allowed == null || proof.paid == null) throw bad("Enter the allowed and the paid amounts: paid, deductible, co-insurance, co-pay and adjustment add up to the allowed.");
          const total = Math.round((proof.paid + (proof.deductible || 0) + (proof.coinsurance || 0) + (proof.copay || 0) + (proof.adjustment || 0)) * 100) / 100;
          if (Math.abs(proof.allowed - total) > 0.005) throw bad(`The amounts do not add up: allowed ${proof.allowed.toFixed(2)}, but paid + deductible + co-insurance + co-pay + adjustment = ${total.toFixed(2)}. Check the EOB.`);
        }
      } else {
        proof = { date: isoDate(p.date), ref: txt(p.ref, 80), mode: txt(p.mode, 40) };
        // for the Submission file (the team's Conso layout): typed by the person, editable for now
        if (h.dept === "submission") for (const [k, n] of [["inv_status", 80], ["bucket", 60], ["claim_type", 60], ["type", 60]]) { const v = txt(p[k], n); if (v) proof[k] = v; }
      }
      // Names of the proof files attached to the claim with this step (optional), so the history shows what backs it.
      const files = (Array.isArray(p.files) ? p.files : []).slice(0, 10).map((f) => str(f, 200).trim()).filter(Boolean);
      if (files.length) proof.files = files;
      // Rejections: what was wrong, for the rejection reports.
      if (h.dept === "rejection") { proof.code = str(p.code, 80).trim(); if (!REJECT_CODES.includes(proof.code)) throw bad("Pick what was wrong with the claim (the rejection code)."); }
      if (h.dept === "subcheck" && !proof.date) throw bad("Enter the date the payer accepted it.");
      if (h.dept !== "subcheck" && (!proof.date || !proof.ref)) throw bad(h.dept === "posting" ? "Enter the posted date and the check / EFT number." : "Enter the submitted date and the batch or claim ID.");
      guard = env.DB.prepare(`UPDATE handoffs SET status = 'complete', done_at = ?, done_by = ?, done_by_name = ?, proof_json = ?, note = ? WHERE id = ? AND ${STILL}`).bind(now, user.id, user.name, JSON.stringify(proof), note, h.id);
      if (h.dept === "posting") {
        // Payment posted: the work is done, so the claim closes for AR (posting QA audits it later).
        stmts.push(env.DB.prepare("UPDATE claims SET handoff_status = 'posted', last_effective = CASE WHEN state IN ('in_process','closed') THEN 'Posting Closed' ELSE last_effective END, last_bucket = CASE WHEN state IN ('in_process','closed') THEN 'Closed' ELSE last_bucket END, state = CASE WHEN state = 'in_process' THEN 'closed' ELSE state END, state_reason = CASE WHEN state = 'in_process' THEN 'Payment posted' ELSE state_reason END, updated_at = ? WHERE id = ?").bind(now, c.id));
      } else if (h.dept === "submission" || h.dept === "rejection") {
        // Submitted: back to the biller with a 15-day follow-up, and always a check after 48 working hours (accepted, or rejected?):
        // the follow-up person set on the client, the biller when the client says so, otherwise whoever submitted it.
        const fu = workingDayOnOrAfter(addDays(today, 15));
        // A team lead's review gave the claim to a biller while this desk had it ("comes to your list when they finish"):
        // it goes on that biller's list now instead of waiting for the 15-day follow-up.
        listed = c.state === IN_PROCESS && !!c.assigned_to && !!(await one(env, "SELECT 1 AS x FROM claim_events WHERE claim_id = ? AND kind = 'review_to_biller' AND at >= ? LIMIT 1", c.id, h.created_at));
        // a claim Posting closed meanwhile (a rejected recheck sent it here) keeps its Posting Closed status and read-only lock
        stmts.push(env.DB.prepare(`UPDATE claims SET handoff_status = 'submitted', last_effective = CASE WHEN state = 'closed' THEN last_effective ELSE 'Pending-Collectible Insurance' END, last_bucket = CASE WHEN state = 'closed' THEN last_bucket ELSE 'Payer' END, follow_up_on = ?, state = CASE WHEN state IN ('completed','assigned','in_process') THEN ? ELSE state END, state_reason = '', first_up = CASE WHEN ? = 1 THEN 1 ELSE first_up END, updated_at = ? WHERE id = ? AND NOT (state = 'closed' AND handoff_status = 'posted')`)
          .bind(listed ? today : fu, listed ? "assigned" : "completed", listed ? 1 : 0, now, c.id));
        const cl = await one(env, "SELECT submission_check_mode, submission_check_person, submission_tat_hours, subcheck_hours FROM clients WHERE id = ?", h.client_id);
        // "The biller" is the AR biller of the claim (biller_id): on a Rejections hand-off created_by is whoever rejected the last recheck.
        const checker = cl && cl.submission_check_mode === "person" && cl.submission_check_person ? await one(env, "SELECT id FROM users WHERE id = ? AND active = 1", cl.submission_check_person) : null;
        const who = (checker && checker.id) || (cl && cl.submission_check_mode === "biller" && (h.biller_id || h.created_by || c.assigned_to || c.last_worked_by)) || user.id;
        if (who) {
          const avail = addWorkingHours(now, subcheckHours(cl)), due = addWorkingHours(avail, tatHours(cl, "submission"));
          stmts.push(env.DB.prepare(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, saag_action, due_at, available_at, lead_id, assigned_to, assigned_at, biller_id, from_dept) VALUES (?,?,?,'subcheck','assigned',?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(uuid(), c.id, h.client_id, now, user.id, user.name, "Submitted " + (proof.ref || ""), due, avail, who, who, now, h.biller_id || h.created_by || c.assigned_to || c.last_worked_by || null, h.dept));
          const wn = await one(env, "SELECT name FROM users WHERE id = ?", who);
          stmts.push(claimEvent(env, c.id, user, "handoff_check", wn ? wn.name : "", { dept: "subcheck", available_at: avail, due_at: due }));
        }
      } else {
        // Submission follow-up: accepted by the payer, the final check is done.
        stmts.push(env.DB.prepare("UPDATE claims SET handoff_status = 'submission_accepted', updated_at = ? WHERE id = ?").bind(now, c.id));
      }
      stmts.push(claimEvent(env, c.id, user, "handoff_done", DEPT_LABEL[h.dept], { dept: h.dept, proof, note, within_tat: now <= h.due_at, ...(listed ? { listed: true } : {}) }));
    } else if (outcome === "rejected" && h.dept === "subcheck") {
      // Rejected: straight back to the Submission team to resubmit, with the reason.
      const reason = str(payload.reason, 80).trim();
      if (!reason) throw bad("Pick the rejection reason.");
      if (!commentOk(note)) throw bad("Write what was rejected and why, a few words at least.");
      guard = env.DB.prepare(`UPDATE handoffs SET status = 'rejected', done_at = ?, done_by = ?, done_by_name = ?, reason = ?, note = ? WHERE id = ? AND ${STILL}`).bind(now, user.id, user.name, reason, note, h.id);
      const cl = await one(env, "SELECT submission_mode, submission_lead, submission_backup, rejection_mode, rejection_lead, rejection_backup, submission_tat_hours FROM clients WHERE id = ?", h.client_id);
      // The Rejections person first (their top priority), otherwise the Submission team.
      const rej = await deskPeople(env, cl, "rejection"), sub = await deskPeople(env, cl, "submission");
      const toRej = !!rej, toSub = !!sub;
      if (toRej || toSub) {
        const due = addWorkingHours(now, tatHours(cl, "submission")), nd = toRej ? "rejection" : "submission", to = rej || sub;
        stmts.push(env.DB.prepare(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, saag_action, due_at, lead_id, backup_id, note, biller_id) VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)`)
          .bind(uuid(), c.id, h.client_id, nd, now, user.id, user.name, "Rejected: " + reason, due, to.lead, to.backup, note, h.biller_id || c.assigned_to || c.last_worked_by || null));
        // A claim already closed (Payment posted meanwhile) stays closed: the Rejections hand-off is there, the claim is not reopened.
        stmts.push(env.DB.prepare("UPDATE claims SET handoff_status = ?, state = ?, state_reason = ?, follow_up_on = '', updated_at = ? WHERE id = ? AND state <> 'closed'").bind("with_" + nd, IN_PROCESS, "With " + DEPT_LABEL[nd], now, c.id));
      } else {
        // Nobody set to resubmit: back to the biller today.
        stmts.push(env.DB.prepare(`UPDATE claims SET handoff_status = 'submission_rejected', follow_up_on = ?, state = CASE WHEN assigned_to IS NOT NULL AND state IN ('completed','assigned','closed') THEN 'assigned' ELSE state END, updated_at = ? WHERE id = ? AND NOT (state = 'closed' AND handoff_status = 'posted')`).bind(today, now, c.id));
      }
      stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, `Submission rejected (${reason}): ${note}`, now));
      stmts.push(claimEvent(env, c.id, user, "handoff_rejected", "Submission", { dept: "subcheck", reason, note, resent: !!(toRej || toSub), to: toRej ? "Rejections" : toSub ? "Submission" : "" }));
    } else if (outcome === "back") {
      // Need assistance from AR: back on the biller's list today with the reason (the 3rd return also goes to the team lead).
      const reason = str(payload.reason, 80).trim();
      if (!reason) throw bad("Pick what is needed from AR.");
      if (!commentOk(note)) throw bad("Write what AR should do, a few words at least.");
      const returns = await returnsOf(env, c.id) + 1;
      // (a claim that stays closed is not escalated either: nothing comes back to AR)
      const bounced = returns >= BOUNCE_LIMIT && !kept;
      const text = `${DEPT_LABEL[h.dept]} needs assistance from AR (${reason}): ${note}` + (bounced ? ` [returned ${returns} times: for both team leads to review]` : "");
      guard = env.DB.prepare(`UPDATE handoffs SET status = 'back', done_at = ?, done_by = ?, done_by_name = ?, reason = ?, note = ? WHERE id = ? AND ${STILL}`).bind(now, user.id, user.name, reason, note, h.id);
      // The third return goes to the AR team lead's Needs attention as well (the department lead sees it on their dashboard).
      stmts.push(bounced
        // "Sent by" for the team lead's review is the AR biller of the claim, not the department person who returned it.
        ? backToAr(pfx + "_back", ", last_note = ?, escalated = 1, escalated_at = ?, escalated_by = ?").bind(pfx + "_back", today, text.slice(0, 600), now, h.biller_id || c.assigned_to || c.last_worked_by || h.created_by || null, now, c.id)
        : backToAr(pfx + "_back", ", last_note = ?").bind(pfx + "_back", today, text.slice(0, 600), now, c.id));
      stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, text, now));
      stmts.push(claimEvent(env, c.id, user, "handoff_back", DEPT_LABEL[h.dept], { dept: h.dept, reason, note, within_tat: now <= h.due_at, returns, bounced, ...(kept ? { kept: c.state } : {}) }));
    } else if (outcome === "pending") {
      // Pending: still with the department, a comment on where it stands; the 24-hour TAT keeps running.
      if (!commentOk(note)) throw bad("Write where it stands, a few words at least.");
      guard = env.DB.prepare(`UPDATE handoffs SET note = ?, pending_at = ?, pending_by_name = ?, desk_state = 'pending' WHERE id = ? AND ${STILL}`).bind(note, now, user.name, h.id);
      stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, `${DEPT_LABEL[h.dept]} · pending: ${note}`, now));
      stmts.push(claimEvent(env, c.id, user, "handoff_pending", DEPT_LABEL[h.dept], { dept: h.dept, note }));
    } else if (outcome === "inprocess" || outcome === "other") {
      // In process: being worked now (a comment is optional). Other: anything else, with the reason. Both stay open; the TAT keeps running.
      const reason = outcome === "other" ? str(payload.reason, 120).trim() : "";
      if (outcome === "other" && reason.length < 3) throw bad("Write the reason for Other.");
      if (outcome === "other" && !commentOk(note)) throw bad("Write a comment on where it stands, a few words at least.");
      const label = outcome === "other" ? "Other: " + reason : "In process";
      guard = env.DB.prepare(`UPDATE handoffs SET note = ?, reason = ?, pending_at = ?, pending_by_name = ?, desk_state = ? WHERE id = ? AND ${STILL}`).bind(note, reason || h.reason || "", now, user.name, outcome === "other" ? "other" : "in_process", h.id);
      stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, `${DEPT_LABEL[h.dept]} · ${label}${note ? ": " + note : ""}`, now));
      stmts.push(claimEvent(env, c.id, user, outcome === "other" ? "handoff_other" : "handoff_inprocess", DEPT_LABEL[h.dept], { dept: h.dept, reason, note }));
    } else if (outcome === "client") {
      // Needs the client: the claim stays with the department (In process for AR); the 24-hour clock keeps running.
      if (h.status === "client") throw bad("It is already waiting on the client.");
      const reason = str(payload.reason, 80).trim();
      if (!reason) throw bad("Pick what is needed from the client.");
      if (!commentOk(note)) throw bad("Write what was asked of the client, a few words at least.");
      const text = `${DEPT_LABEL[h.dept]} needs client assistance (${reason}): ${note}`;
      // It goes to the AR team lead's Client requests to send; the claim comes back as "Chase the client" 3 working days after the
      // team lead sends it (attention.clientSent starts that clock: a request nobody sent is not chased). Asking again on the same
      // hand-off starts a new round: the earlier round's sent and answered times are cleared, so the new request is never counted
      // as sent or answered (met on the month's TAT) by the old ones.
      guard = env.DB.prepare(`UPDATE handoffs SET status = 'client', reason = ?, note = ?, paused_at = ?, client_req_by_name = ?, chase_at = NULL,
          client_sent_at = NULL, client_sent_by = NULL, client_sent_by_name = '', client_sent_how = '', client_sent_note = '', client_answered_at = NULL WHERE id = ? AND status IN ('pending','assigned')`).bind(reason, note, now, user.name, h.id);
      stmts.push(env.DB.prepare("UPDATE claims SET handoff_status = ?, state_reason = ?, last_bucket = 'Client', updated_at = ? WHERE id = ?" + KEEP).bind(pfx + "_client", "Waiting on client (" + DEPT_LABEL[h.dept] + ")", now, c.id));
      stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, text, now));
      stmts.push(claimEvent(env, c.id, user, "handoff_client", DEPT_LABEL[h.dept], { dept: h.dept, reason, note }));
    } else if (outcome === "resume") {
      // The client answered: back in the open list, with the same due time (the clock never stopped).
      if (h.status !== "client") throw bad("Only a claim waiting on the client can be resumed.");
      const due = h.due_at;
      guard = env.DB.prepare("UPDATE handoffs SET status = CASE WHEN assigned_to IS NOT NULL THEN 'assigned' ELSE 'pending' END, chase_at = NULL, client_answered_at = ?, note = ? WHERE id = ? AND status = 'client'").bind(now, note || h.note || "", h.id);
      stmts.push(env.DB.prepare("UPDATE claims SET handoff_status = ?, state_reason = ?, updated_at = ? WHERE id = ?" + KEEP).bind("with_" + (h.dept === "subcheck" ? "submission" : h.dept), "With " + DEPT_LABEL[h.dept], now, c.id));
      if (note) stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, `${DEPT_LABEL[h.dept]}: client answered. ${note}`, now));
      stmts.push(claimEvent(env, c.id, user, "handoff_resume", DEPT_LABEL[h.dept], { dept: h.dept, note, due_at: due }));
    } else throw bad("Pick what happened: completed, in process, pending, need assistance from AR, need assistance from client or other.");
    // The biller who sent it hears at once (bell + My work): completed, sent back, or waiting on the client.
    // The AR biller of the hand-off (biller_id), not whoever created it (a team lead's review, or a rejected recheck).
    const sentBy = h.biller_id || h.created_by;
    const billerId = sentBy && sentBy !== user.id ? sentBy : null;
    const tellBiller = { complete: h.dept === "posting" ? "posted" : h.dept === "subcheck" ? "confirmed the payer accepted" : "submitted", back: "sent back to you", client: "is waiting on the client for" }[outcome];
    // a claim that stays closed is not sent back to anyone's list, so nobody is told it is
    if (billerId && tellBiller && h.dept !== "subcheck" && !(outcome === "back" && kept)) {
      const cno = c.claim_no || c.account_no || "a claim";
      const text = outcome === "complete" ? `${user.name} ${tellBiller} claim ${cno} (${DEPT_LABEL[h.dept]} complete)` + (listed ? ". It is first on your list now." : "")
        : outcome === "back" ? `${DEPT_LABEL[h.dept]}: ${user.name} sent claim ${cno} back to you (${str(payload.reason, 80).trim()})`
        : `${DEPT_LABEL[h.dept]}: claim ${cno} is waiting on the client (${str(payload.reason, 80).trim()})`;
      stmts.push(env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)").bind(uuid(), billerId, now, text.slice(0, 300), outcome === "back" || listed ? "queue" : "history", h.client_id));
    }
    // Sent back to AR: the biller whose list it is on hears too (when that is someone else), and it is first on their list.
    if (outcome === "back" && !kept && c.assigned_to && c.assigned_to !== billerId && c.assigned_to !== user.id)
      stmts.push(env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)").bind(uuid(), c.assigned_to, now,
        `${DEPT_LABEL[h.dept]}: ${user.name} sent claim ${c.claim_no || c.account_no || ""} back to AR (${str(payload.reason, 80).trim()}). It is first on your list.`.slice(0, 300), "queue", h.client_id));
    if (guard && !changesOf(await guard.run())) {
      const cur = await one(env, "SELECT status FROM handoffs WHERE id = ?", h.id);
      throw bad(outcome === "resume" ? "Only a claim waiting on the client can be resumed." : outcome === "client" ? "It is already waiting on the client, or the hand-off is closed."
        : cur && ["pending", "assigned", "client"].includes(cur.status) ? "Someone else changed this hand-off at the same moment. Open it again to see where it stands." : "This hand-off is already closed.");
    }
    await env.DB.batch(stmts);
    if (!env.DEMO && env.MS_CLIENT_SECRET) { const p = deskProduction(env, user, h.id, outcome); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p; }
    // listed: the claim went on a biller's list now (a team lead's review gave it to them while the desk had it)
    return { ok: true, ...(listed ? { listed: true } : {}) };
  },

  /* ---- needs attention: claims a biller escalated to a team lead. 24 hours to answer (TAT); after that they show red. ---- */
  /* ---- patient details from another report: some inventory files lack patient details; a second report (demographics / PM report)
     is matched to the claims already loaded by claim # or account # and fills them, so the team does not VLOOKUP in Excel before allocating. */
  "inventory.enrich": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60), locId = payload.location_id ? str(payload.location_id, 60) : null;
    if (!clientId) throw bad("Pick the client.");
    editableOr(user, clientId);
    const purpose = str(payload.purpose, 120).trim();
    if (!purpose) throw bad("Say why you are uploading this report.");
    const overwrite = payload.overwrite ? 1 : 0;
    const rows = (Array.isArray(payload.rows) ? payload.rows : []).slice(0, 2000);
    const now = Date.now();
    let up = payload.upload_id ? await one(env, "SELECT * FROM detail_uploads WHERE id = ? AND client_id = ?", str(payload.upload_id, 60), clientId) : null;
    if (!up) {
      up = { id: uuid() };
      await run(env, "INSERT INTO detail_uploads (id, client_id, location_id, user_id, user_name, created_at, file_name, purpose, note, overwrite) VALUES (?,?,?,?,?,?,?,?,?,?)",
        up.id, clientId, locId, user.id, user.name, now, str(payload.file_name, 200), purpose, str(payload.note, 500).trim(), overwrite);
      up = await one(env, "SELECT * FROM detail_uploads WHERE id = ?", up.id);
    }
    const FIELDS_E = ["patient", "account_no", "payer", "provider", "patient_dob", "member_id", "patient_phone"];
    const clean = rows.map((r) => {
      const o = { claim_no: str(r.claim_no, 80).trim(), account_no: str(r.account_no, 80).trim().replace(/\.0+$/, "") };
      for (const k of FIELDS_E) if (k !== "account_no") o[k] = str(r[k], 160).trim();
      if (o.patient_dob) o.patient_dob = isoDate(o.patient_dob) || o.patient_dob;
      o.extra = {}; if (r.extra && typeof r.extra === "object") for (const [k, v] of Object.entries(r.extra).slice(0, 40)) { const t = str(v, 200).trim(); if (t) o.extra[str(k, 80)] = t; }
      o._alt = altKeyOf(o.claim_no);
      return o;
    }).filter((o) => o._alt || o.account_no);
    // Find the claims: by claim # first, then every claim of the account.
    const loc = locId ? " AND location_id = ?" : "", locArgs = locId ? [locId] : [];
    const cols = "id, claim_no, alt_key, account_no, patient, payer, provider, patient_dob, member_id, patient_phone, raw_json";
    const byAlt = new Map(), byAcct = new Map();
    const alts = [...new Set(clean.map((o) => o._alt).filter(Boolean))], accts = [...new Set(clean.map((o) => o.account_no).filter(Boolean))];
    for (const part of chunks(alts, 80)) for (const c of await all(env, `SELECT ${cols} FROM claims WHERE client_id = ?${loc} AND alt_key IN (${part.map(() => "?").join(",")})`, clientId, ...locArgs, ...part)) byAlt.set(c.alt_key, c);
    for (const part of chunks(accts, 80)) for (const c of await all(env, `SELECT ${cols} FROM claims WHERE client_id = ?${loc} AND account_no IN (${part.map(() => "?").join(",")})`, clientId, ...locArgs, ...part)) { if (!byAcct.has(c.account_no)) byAcct.set(c.account_no, []); byAcct.get(c.account_no).push(c); }
    const fieldCounts = jsonObj(up.fields_json);
    const unmatched = (() => { try { return JSON.parse(up.unmatched_json || "[]"); } catch { return []; } })();
    const touched = new Map();
    let matched = 0;
    for (const o of clean) {
      const hit = o._alt && byAlt.get(o._alt) ? [byAlt.get(o._alt)] : (o.account_no && byAcct.get(o.account_no)) || [];
      if (!hit.length) { if (unmatched.length < 500) unmatched.push({ claim_no: o.claim_no, account_no: o.account_no, patient: o.patient }); continue; }
      matched++;
      for (const c0 of hit) {
        const c = touched.get(c0.id) || { ...c0, _set: {}, _raw: null };
        for (const k of FIELDS_E) {
          const v = o[k];
          if (!v || String(c[k] || "") === v || (!overwrite && String(c[k] || "").trim())) continue;
          c._set[k] = v; c[k] = v;
        }
        const ex = Object.entries(o.extra);
        if (ex.length) { const raw = c._raw || jsonObj(c.raw_json); let ch = false; for (const [k, v] of ex) { const key = "Details · " + k; if (raw[key] !== v && (overwrite || !raw[key])) { raw[key] = v; ch = true; } } if (ch) c._raw = raw; }
        touched.set(c.id, c);
      }
    }
    const stmts = [];
    let updated = 0;
    for (const c of touched.values()) {
      const keys = Object.keys(c._set);
      if (!keys.length && !c._raw) continue;
      updated++;
      for (const k of keys) fieldCounts[k] = (fieldCounts[k] || 0) + 1;
      if (c._raw) fieldCounts.other = (fieldCounts.other || 0) + 1;
      const sets = keys.map((k) => k + " = ?"), args = keys.map((k) => c._set[k]);
      if (c._raw) { sets.push("raw_json = ?"); args.push(str(JSON.stringify(c._raw), 20000)); }
      stmts.push(env.DB.prepare(`UPDATE claims SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...args, now, c.id));
      stmts.push(claimEvent(env, c.id, user, "enriched", str(payload.file_name, 200), { purpose, fields: keys, other: !!c._raw }));
    }
    if (stmts.length) await batchAll(env, stmts, 40);
    await run(env, "UPDATE detail_uploads SET rows_read = rows_read + ?, rows_matched = rows_matched + ?, claims_updated = claims_updated + ?, fields_json = ?, unmatched_json = ? WHERE id = ?",
      rows.length, matched, updated, JSON.stringify(fieldCounts), JSON.stringify(unmatched), up.id);
    return { upload_id: up.id, rows: rows.length, matched, updated, fields: fieldCounts };
  },
  "inventory.enrichList": async ({ env, user, payload }) => {
    const rows = await all(env, `SELECT d.*, c.name AS client_name, l.name AS location_name FROM detail_uploads d LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN locations l ON l.id = d.location_id
      WHERE 1 = 1${scopeSql(user, "d.client_id")} ORDER BY d.created_at DESC LIMIT ?`, ...scopeArgs(user), Math.min(200, Math.max(1, Math.round(num(payload.limit, 30)))));
    return { rows: rows.map((r) => ({ ...r, fields: jsonObj(r.fields_json), unmatched: (() => { try { return JSON.parse(r.unmatched_json || "[]"); } catch { return []; } })(), fields_json: undefined, unmatched_json: undefined })) };
  },
  /* ---- insurance TFL / AFL: one row per client and insurance with open claims or saved limits, and how much is near or past the TFL ---- */
  "payers.limits": async ({ env, user, payload }) => {
    const today = isoDate(payload.today) || isoToday();
    const lims = await all(env, `SELECT p.*, cl.name AS client_name FROM payer_limits p LEFT JOIN clients cl ON cl.id = p.client_id WHERE 1 = 1${scopeSql(user, "p.client_id")}`, ...scopeArgs(user));
    const groups = await all(env, `SELECT c.client_id, cl.name AS client_name, c.payer, c.dos, c.status_class, c.denial_date, COUNT(*) AS n, SUM(c.balance) AS bal FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.state IN ${WORKABLE}${scopeSql(user, "c.client_id")} GROUP BY c.client_id, c.payer, c.dos, c.status_class, c.denial_date`, ...scopeArgs(user));
    const rows = new Map();
    const row = (client_id, client_name, payer) => {
      const k = client_id + "|" + payerKey(payer);
      if (!rows.has(k)) rows.set(k, { client_id, client_name: client_name || "", payer: payer || "", payer_key: payerKey(payer), tfl_days: null, afl_days: null, note: "", updated_at: null, updated_by_name: "", source: "",
        open_n: 0, open_bal: 0, past_n: 0, past_bal: 0, soon_n: 0, soon_bal: 0, no_dos_n: 0, afl_past_n: 0, afl_past_bal: 0, afl_soon_n: 0, afl_soon_bal: 0, afl_no_date_n: 0 });
      return rows.get(k);
    };
    for (const l of lims) Object.assign(row(l.client_id, l.client_name, l.payer), { tfl_days: l.tfl_days, afl_days: l.afl_days, note: l.note, updated_at: l.updated_at, updated_by_name: l.updated_by_name, source: l.source });
    const day = (iso) => Date.parse(iso + "T00:00:00Z") / 86400000;
    for (const g of groups) {
      if (!payerKey(g.payer)) continue;
      const r = row(g.client_id, g.client_name, g.payer);
      r.open_n += g.n; r.open_bal += g.bal || 0;
      if (r.afl_days && AFL_CLASSES.includes(g.status_class)) {
        if (!isoDate(g.denial_date)) r.afl_no_date_n += g.n;
        else { const left = day(g.denial_date) + r.afl_days - day(today); if (left < 0) { r.afl_past_n += g.n; r.afl_past_bal += g.bal || 0; } else if (left <= 30) { r.afl_soon_n += g.n; r.afl_soon_bal += g.bal || 0; } }
      }
      if (!r.tfl_days || !TFL_CLASSES.includes(g.status_class)) continue;
      if (!isoDate(g.dos)) { r.no_dos_n += g.n; continue; }
      const left = day(g.dos) + r.tfl_days - day(today);
      if (left < 0) { r.past_n += g.n; r.past_bal += g.bal || 0; } else if (left <= 30) { r.soon_n += g.n; r.soon_bal += g.bal || 0; }
    }
    return { rows: [...rows.values()], today };
  },
  "payers.saveLimit": async ({ env, user, payload }) => {
    const clientId = str(payload.client_id, 60);
    editableOr(user, clientId);
    if (!clientId || !(await one(env, "SELECT id FROM clients WHERE id = ?", clientId))) throw bad("Pick the client.");
    const payer = str(payload.payer, 160).trim();
    if (!payerKey(payer)) throw bad("Pick the insurance.");
    const tfl = limitDays(payload.tfl_days), afl = limitDays(payload.afl_days);
    if (String(payload.tfl_days || "").trim() && !tfl) throw bad("TFL must be a number of days (1 to 3650).");
    if (String(payload.afl_days || "").trim() && !afl) throw bad("AFL must be a number of days (1 to 3650).");
    await run(env, `INSERT INTO payer_limits (client_id, payer_key, payer, tfl_days, afl_days, note, source, updated_at, updated_by, updated_by_name) VALUES (?,?,?,?,?,?,'team lead',?,?,?)
        ON CONFLICT (client_id, payer_key) DO UPDATE SET payer = excluded.payer, tfl_days = excluded.tfl_days, afl_days = excluded.afl_days, note = excluded.note, source = excluded.source,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name`,
      clientId, payerKey(payer), payer, tfl, afl, str(payload.note, 300).trim(), Date.now(), user.id, user.name);
    await audit(env, user, "payers.limit", clientId, payer.slice(0, 80) + " · TFL " + (tfl || "–") + " · AFL " + (afl || "–"));
    return { ok: true };
  },
  "attention.list": async ({ env, user }) => {
    const rows = await all(env, `SELECT c.id, c.client_id, c.location_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, c.age_days, c.tier, c.state, c.follow_up_on,
        c.last_status_code, c.last_sub_status, c.last_action_code, c.last_note, c.escalated_at, c.escalated_by, c.assigned_to, u.name AS assigned_name, e.name AS escalated_by_name, cl.name AS client_name, l.name AS location_name,
        cl.posting_mode, cl.submission_mode, cl.rejection_mode,
        (SELECT h.dept FROM handoffs h WHERE h.claim_id = c.id AND h.status IN ('back','assistance') ORDER BY h.done_at DESC LIMIT 1) AS last_dept,
        (SELECT hb.dept FROM handoffs hb WHERE hb.claim_id = c.id AND hb.status IN ('assistance','back') AND hb.done_at = c.escalated_at LIMIT 1) AS bounced_dept,
        (SELECT COUNT(*) FROM handoffs hr WHERE hr.claim_id = c.id AND hr.status IN ('assistance','back')) AS returns
      FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN users e ON e.id = c.escalated_by LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
      WHERE c.escalated = 1 AND c.state IN ${ESCALATION_STATES} AND NOT ${BOUNCE_WAITING_SQL("c")}${scopeSql(user, "c.client_id")} ORDER BY c.escalated_at ASC LIMIT 500`, ...scopeArgs(user));
    const now = Date.now();
    const out = rows.map((r) => ({ ...reviewShape(r), flag_label: r.bounced_dept ? `Returned ${r.returns} times by ${DEPT_LABEL[r.bounced_dept] || r.bounced_dept}` : "", waiting_ms: r.escalated_at ? workingHoursBetween(r.escalated_at, now) * 3600000 : 0, overdue: !!r.escalated_at && addWorkingHours(r.escalated_at, ATTN_TAT_HOURS) < now, sent_by_id: r.escalated_by || r.assigned_to || null,
      sent_by_name: r.escalated_by_name || r.assigned_name || "" }));
    return { rows: out, overdue: out.filter((r) => r.overdue).length, tat_hours: ATTN_TAT_HOURS, people: await reviewPeople(env, user) };
  },
  /* Client requests: claims Posting / Submission / Rejections need the client for. Sending them to the client is the AR team
     lead's job; marking one Sent records how and when, and the department chases the client 3 working days later. */
  "attention.clientRequests": async ({ env, user }) => {
    const rows = await all(env, `SELECT h.id, h.claim_id, h.client_id, h.dept, h.reason, h.note, h.paused_at AS asked_at, h.client_req_by_name AS asked_by, h.client_sent_at, h.client_sent_by_name, h.client_sent_how, h.client_sent_note,
        h.chase_at, h.due_at, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, cl.name AS client_name, l.name AS location_name, u.name AS biller_name
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = h.client_id LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN users u ON u.id = c.assigned_to
      WHERE h.status = 'client'${scopeSql(user, "h.client_id")} ORDER BY h.client_sent_at IS NOT NULL, h.paused_at LIMIT 500`, ...scopeArgs(user));
    const now = Date.now();
    const out = rows.map((r) => ({ ...r, dept_label: DEPT_LABEL[r.dept] || r.dept, late: !r.client_sent_at && now > addWorkingHours(r.asked_at || now, ATTN_TAT_HOURS), chase: !!r.chase_at && now >= r.chase_at }));
    return { rows: out, to_send: out.filter((r) => !r.client_sent_at).length, late: out.filter((r) => r.late).length, hows: CLIENT_SENT_HOW };
  },
  /* Sent back to AR: claims Posting, Submission or Rejections returned with "Need assistance from AR" in the last 30 days that
     nobody on AR has worked since. They show for the AR team leads (and up) of the client until a biller saves an entry. */
  "attention.fromDesks": async ({ env, user }) => {
    const rows = await all(env, `SELECT h.id, h.claim_id, h.dept, h.status, h.reason, h.note, h.done_at, h.done_by_name, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, c.state,
        c.client_id, c.assigned_to, c.reviewed_at, c.reviewed_by_name, h.biller_id, h.created_by, cl.posting_mode, cl.submission_mode, cl.rejection_mode,
        cl.name AS client_name, l.name AS location_name, u.name AS biller_name,
        (SELECT COUNT(*) FROM handoffs r WHERE r.claim_id = h.claim_id AND r.status IN ('back','assistance')) AS returns
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = h.client_id LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN users u ON u.id = c.assigned_to
      WHERE h.status IN ('assistance','back') AND h.done_at > ? AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.claim_id = h.claim_id AND n.kind = 'work' AND n.created_at > h.done_at)
        AND NOT EXISTS (SELECT 1 FROM handoffs h2 WHERE h2.claim_id = h.claim_id AND h2.created_at > h.done_at)${scopeSql(user, "h.client_id")}
      ORDER BY h.done_at ASC LIMIT 500`, Date.now() - 30 * 86400000, ...scopeArgs(user));
    const now = Date.now();
    return { rows: rows.map((r) => ({ ...reviewShape({ ...r, last_dept: r.dept }), dept_label: DEPT_LABEL[r.dept] || r.dept, late: now > addWorkingHours(r.done_at, ATTN_TAT_HOURS) && !(r.reviewed_at && r.reviewed_at > r.done_at),
      sent_by_id: r.assigned_to || r.biller_id || r.created_by || null, sent_by_name: r.biller_name || "", reviewed: !!r.reviewed_at && r.reviewed_at > r.done_at })), people: await reviewPeople(env, user) };
  },
  "attention.clientSent": async ({ env, user, payload }) => {
    const h = await one(env, "SELECT * FROM handoffs WHERE id = ?", str(payload.id, 60));
    if (!h) throw bad("That request was not found.");
    if (h.status !== "client") throw bad("This request is no longer waiting on the client.");
    editableOr(user, h.client_id);
    if (h.client_sent_at) throw bad(`This request was already sent to the client${h.client_sent_by_name ? " by " + h.client_sent_by_name : ""}.`);
    const how = CLIENT_SENT_HOW.includes(payload.how) ? payload.how : "";
    if (!how) throw bad("Pick how it was sent to the client.");
    const note = str(payload.note, 600).trim(), now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE handoffs SET client_sent_at = ?, client_sent_by = ?, client_sent_by_name = ?, client_sent_how = ?, client_sent_note = ?, chase_at = ? WHERE id = ?")
        .bind(now, user.id, user.name, how, note, addWorkingHours(now, CHASE_HOURS), h.id),
      env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), h.claim_id, user.id, user.name,
        `Sent to the client (${how}) for ${DEPT_LABEL[h.dept]}: ${h.reason}` + (note ? ". " + note : ""), now),
      claimEvent(env, h.claim_id, user, "handoff_client_sent", DEPT_LABEL[h.dept], { dept: h.dept, how, note, reason: h.reason }),
    ]);
    return { ok: true };
  },
  /* ---- Escalation tracker (under Work): SMEs and above log and edit; team leads and up give the reason when one is open past 24 hours ---- */
  "escalations.list": async ({ env, user, payload }) => {
    const where = [], args = [];
    const cid = str(payload.client_id, 60);
    if (cid) { if (!inScope(user, cid)) throw outOfScope(); where.push("e.client_id = ?"); args.push(cid); }
    if (ESC_DEPTS.includes(payload.dept)) { where.push("e.dept = ?"); args.push(payload.dept); }
    if (isEscKind(payload.kind)) where.push(payload.kind === "internal" ? "e.kind = 'internal'" : "e.kind <> 'internal'");
    const from = isoDate(payload.from), to = isoDate(payload.to);
    if (from) { where.push("e.day >= ?"); args.push(from); }
    if (to) { where.push("e.day <= ?"); args.push(to); }
    const rows = await all(env, `SELECT e.*, cl.name AS client_name FROM escalations e LEFT JOIN clients cl ON cl.id = e.client_id
      WHERE 1 = 1${where.map((w) => " AND " + w).join("")}${scopeSql(user, "e.client_id")} ORDER BY e.day DESC, e.created_at DESC LIMIT 1000`, ...args, ...scopeArgs(user));
    const now = Date.now(), today = isoDate(payload.today) || istISO(now), month = today.slice(0, 7);
    const isTL = !isSME(user);
    const out = rows.map((e) => {
      const open = e.status !== "resolved", past = open && escPast(e.created_at, now);
      return { ...e, kind: escKind(e), kind_label: ESC_KINDS[escKind(e)], status_label: ESC_STATUS[e.status] || e.status, hours: escHours(e), review_result: escReviewResult(e),
        month: /^\d{4}-\d{2}/.test(e.day || "") ? ESC_MONTHS[+e.day.slice(5, 7) - 1] || "" : "", open_hours: open ? Math.floor(workingHoursBetween(e.created_at, now)) : null, past_24: past,
        needs_reason: past && !e.delay_reason, past_expected: open && !!e.expected_on && e.expected_on < today,
        can_edit: canEditClient(user, e.client_id), can_reason: isTL && canEditClient(user, e.client_id) && past };
    });
    const st = String(payload.status || "");
    const shown = st === "open" ? out.filter((e) => e.status !== "resolved") : st === "resolved" ? out.filter((e) => e.status === "resolved") : st === "reason" ? out.filter((e) => e.needs_reason) : out;
    // closed this month: by the close date typed in
    const done = out.filter((e) => e.status === "resolved" && (e.close_on || (e.resolved_at ? istISO(e.resolved_at) : "")).slice(0, 7) === month);
    const stats = { open: out.filter((e) => e.status !== "resolved").length, needs_reason: out.filter((e) => e.needs_reason).length, past_expected: out.filter((e) => e.past_expected).length,
      logged_month: out.filter((e) => e.day.slice(0, 7) === month).length, resolved_month: done.length, closed_month: done.length,
      logged_external: out.filter((e) => e.day.slice(0, 7) === month && e.kind === "external").length, logged_internal: out.filter((e) => e.day.slice(0, 7) === month && e.kind === "internal").length,
      open_external: out.filter((e) => e.status !== "resolved" && e.kind === "external").length, open_internal: out.filter((e) => e.status !== "resolved" && e.kind === "internal").length,
      avg_hours: done.length ? Math.round(done.reduce((t, e) => t + e.hours, 0) / done.length) : null };
    const file = cid ? await getSetting(env, "workbook_status:" + cid + ":esc", null) : null;
    const slaFile = cid ? await getSetting(env, "workbook_status:" + cid + ":escsla", null) : null;
    let sla = null;
    if (cid) {
      // the client's SLA: external escalations make its KPI (target 0); internal ones are counted beside them
      const m = await all(env, "SELECT CASE WHEN kind = 'internal' THEN 'internal' ELSE 'external' END AS k, dept, COUNT(*) AS n FROM escalations WHERE client_id = ? AND substr(day, 1, 7) = ? GROUP BY 1, 2", cid, month);
      const ex = m.filter((x) => x.k === "external"), inn = m.filter((x) => x.k === "internal"), n = ex.reduce((t, x) => t + x.n, 0);
      sla = { month: monthLabel(month), target: ESC_SLA_TARGET, n, met: n <= ESC_SLA_TARGET, by_dept: ex.map((x) => ({ dept: x.dept, n: x.n })),
        internal: inn.reduce((t, x) => t + x.n, 0), by_dept_internal: inn.map((x) => ({ dept: x.dept, n: x.n })) };
    }
    const people = (await all(env, "SELECT id, name, designation, source FROM users WHERE active = 1 AND role IN ('supervisor','admin') ORDER BY name"))
      .map((u) => ({ id: u.id, name: u.name, tag: isSME(u) ? "SME" : /manager|vice|director|head/i.test(u.designation || "") ? (u.designation || "") : "TL" }));
    return { rows: shown, stats, file, sla_file: slaFile, sla, onedrive: !env.DEMO && !!env.MS_CLIENT_SECRET, people, depts: ESC_DEPTS, kinds: ESC_KINDS, channels: ESC_CHANNELS, can_reason: isTL };
  },
  "escalations.save": async ({ env, user, payload, ctx }) => {
    const id = str(payload.id, 60), now = Date.now();
    const ex = id ? await one(env, "SELECT * FROM escalations WHERE id = ?", id) : null;
    if (id && !ex) throw bad("That escalation is no longer there.");
    const clientId = ex ? ex.client_id : str(payload.client_id, 60);
    const c = clientId ? await one(env, "SELECT id, name FROM clients WHERE id = ?", clientId) : null;
    if (!c) throw bad("Pick the client.");
    editableOr(user, c.id);
    // the type comes first: External (raised by the client) or Internal (raised inside Purview)
    const kind = isEscKind(payload.kind) ? payload.kind : ex ? escKind(ex) : "";
    if (!kind) throw bad("Pick the type first: External (raised by the client) or Internal (raised inside Purview).");
    const day = isoDate(payload.day), today = istISO(now);
    if (!day) throw bad("Pick the received date.");
    const realDay = (d) => { const t = Date.parse(d + "T00:00:00Z"); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; };
    if (!realDay(day)) throw bad("The received date is not a real date.");
    if (payload.status === "resolved" || payload.status === "closed") { const co = isoDate(payload.close_on); if (co && !realDay(co)) throw bad("The close date is not a real date."); }
    if (day > today) throw bad("The received date cannot be in the future.");
    const dept = ESC_DEPTS.includes(payload.dept) ? payload.dept : ""; if (!dept) throw bad("Pick the department.");
    const raisedBy = str(payload.raised_who, 120).trim(); if (!raisedBy) throw bad(kind === "internal" ? "Who raised it? A name or team at Purview." : "Who raised it? Name or role at the client.");
    const reportedTo = str(payload.reported_to, 120).trim(); if (!reportedTo) throw bad(kind === "internal" ? "Who was it reported to?" : "Who was it reported to at Purview?");
    const description = str(payload.description, 2000).trim();
    if (description.length < 8) throw bad("Write the error description, a sentence at least.");
    // every field is filled: the subject (a short title when it did not come by email) and a comment too
    const subject = str(payload.email_subject, 300).trim();
    if (subject.length < 3) throw bad("Write the email subject (or a short title if it did not come by email).");
    const comment = str(payload.comment, 2000).trim();
    if (comment.length < 3) throw bad("Write a comment, a few words at least.");
    const status = payload.status === "resolved" || payload.status === "closed" ? "resolved" : "open";
    const isError = ["Y", "N"].includes(payload.is_error) ? payload.is_error : "";
    // our error: who made it, and the DOW (the date the work with the error was done)
    let errBy = null, dow = "";
    if (isError === "Y") {
      const bid = str(payload.error_by_id, 60);
      errBy = bid ? await one(env, "SELECT id, name FROM users WHERE id = ?", bid) : null;
      if (!errBy) throw bad("Our error: pick who made the error.");
      dow = isoDate(payload.error_dow);
      if (!dow) throw bad("Our error: pick the DOW, the date the work with the error was done.");
      if (!realDay(dow)) throw bad("The DOW of the error is not a real date.");
      if (dow > day) throw bad("The DOW of the error cannot be after the received date.");
    }
    const rca = str(payload.rca, 2000).trim(), corrective = str(payload.corrective, 2000).trim(), preventive = str(payload.preventive, 2000).trim();
    const closeOn = status === "resolved" ? isoDate(payload.close_on) : "";
    if (status === "resolved") {
      if (!isError) throw bad("To close it, say whether it was an error: Y or N.");
      if (rca.length < 8) throw bad("To close it, write the root cause.");
      if (corrective.length < 8) throw bad("To close it, write the corrective action.");
      if (preventive.length < 8) throw bad("To close it, write the preventive action.");
      if (!closeOn) throw bad("To close it, pick the close date.");
      if (closeOn < day || closeOn > today) throw bad("The close date must be between the received date and today.");
    }
    let owner = null;
    if (payload.owner_id) owner = await one(env, "SELECT id, name FROM users WHERE id = ? AND active = 1", str(payload.owner_id, 60));
    if (!owner) throw bad("Pick the responding person at Purview.");
    // location (one of this client's), the channels it came through, the review date and whether the rework is done
    // an update that does not send the location keeps the one saved
    const locId = payload.location_id != null && payload.location_id !== "" ? str(payload.location_id, 60) : ex ? (ex.location_id || (ex.location_name === "All locations" ? "all" : "")) : "";
    if (!locId) throw bad("Pick the location (or All locations).");
    const loc = locId === "all" ? null : await one(env, "SELECT id, name FROM locations WHERE id = ? AND client_id = ?", locId, c.id);
    if (locId !== "all" && !loc) throw bad("Pick one of this client's locations (or All locations).");
    const chosen = (Array.isArray(payload.channels) ? payload.channels : String(payload.channels != null ? payload.channels : ex ? ex.channels || "" : "").split(/[,;]+/)).map((x) => String(x || "").trim().toLowerCase());
    const channels = ESC_CHANNELS.filter((k) => chosen.includes(k.toLowerCase())).join(", ");
    if (!channels) throw bad("Pick the channels used: Email, Teams or Call.");
    const reviewOn = isoDate(payload.review_on) || "";
    if (String(payload.review_on || "").trim() && !reviewOn) throw bad("The review date is not a date.");
    if (reviewOn && !realDay(reviewOn)) throw bad("The review date is not a real date.");
    if (reviewOn && (reviewOn < day || reviewOn > today)) throw bad("The review date must be between the received date and today.");
    const rework = ["Yes", "No"].includes(payload.rework) ? payload.rework : "";
    // to close it, the review is done: the review date and whether the rework is completed
    if (status === "resolved" && !reviewOn) throw bad("To close it, pick the review date.");
    if (status === "resolved" && !rework) throw bad("To close it, say whether the rework is completed: Yes or No.");
    const vals = { day, dept, raised_who: raisedBy, reported_to: reportedTo, email_subject: subject, owner_id: owner.id, owner_name: owner.name, description,
      is_error: isError, comment, status, rca, corrective, preventive, close_on: closeOn, resolved_at: status === "resolved" ? ((ex && ex.resolved_at) || now) : null,
      kind, error_by_id: errBy ? errBy.id : null, error_by_name: errBy ? errBy.name : "", error_dow: dow,
      location_id: loc ? loc.id : null, location_name: loc ? loc.name : "All locations", channels, review_on: reviewOn, rework };
    const cols = Object.keys(vals);
    let sr;
    if (ex) {
      sr = ex.sr;
      await run(env, `UPDATE escalations SET ${cols.map((k) => k + " = ?").join(", ")}, updated_at = ?, updated_by_name = ? WHERE id = ?`, ...cols.map((k) => vals[k]), now, user.name || "", ex.id);
    } else {
      // The next SR number is worked out inside the INSERT itself (one statement), so two escalations logged at once get SR n and n+1;
      // the unique (client, SR) index catches anything left, and the insert is tried again.
      const eid = uuid();
      for (let attempt = 0; ; attempt++) {
        try {
          await run(env, `INSERT INTO escalations (id, client_id, sr, ${cols.join(", ")}, created_at, created_by, created_by_name)
              SELECT ?, ?, COALESCE(MAX(sr), 0) + 1, ${cols.map(() => "?").join(",")}, ?, ?, ? FROM escalations WHERE client_id = ?`,
            eid, c.id, ...cols.map((k) => vals[k]), now, user.id, user.name || "", c.id);
          break;
        } catch (e) { if (attempt >= 4 || !/unique/i.test(String(e && e.message))) throw e; }
      }
      sr = ((await one(env, "SELECT sr FROM escalations WHERE id = ?", eid)) || {}).sr;
    }
    await audit(env, user, ex ? "escalation.edit" : "escalation.add", c.id, `SR${sr} ${ESC_KINDS[kind]} · ${dept}: ${ESC_STATUS[status]}` + (isError === "Y" ? ` · our error (${errBy.name})` : ""));
    // the project's supervisors hear about a new escalation, and about one marked as our error later
    const what = !ex ? "new" : isError === "Y" && ex.is_error !== "Y" ? "error" : "";
    const defer = ctx && ctx.waitUntil ? (q) => ctx.waitUntil(q) : null;
    if (what) { try { await escalationNotice(env, { ...vals, sr, client_id: c.id }, c.name, user, what, env.APP_URL, defer); } catch (x) {} }
    const p = syncEscalations(env, c.id, [day.slice(0, 7), ex ? ex.day.slice(0, 7) : ""]); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
    return { ok: true, sr };
  },
  /* Still open after 24 hours: a team lead (or above) says why and when it will close. */
  "escalations.reason": async ({ env, user, payload, ctx }) => {
    const e = await one(env, "SELECT * FROM escalations WHERE id = ?", str(payload.id, 60));
    if (!e) throw bad("That escalation is no longer there.");
    editableOr(user, e.client_id);
    if (isSME(user)) throw denied("The reason and expected date are given by the team lead. Ask your team lead.");
    if (e.status === "resolved") throw bad("This escalation is already closed.");
    const reason = str(payload.reason, 1000).trim(), on = isoDate(payload.expected_on), today = istISO(Date.now());
    if (reason.length < 8) throw bad("Write why it is still open, a sentence at least.");
    if (!on || on < today) throw bad("Pick the expected close date, today or later.");
    await run(env, "UPDATE escalations SET delay_reason = ?, expected_on = ?, delay_by_name = ?, delay_at = ?, updated_at = ?, updated_by_name = ? WHERE id = ?", reason, on, user.name || "", Date.now(), Date.now(), user.name || "", e.id);
    await audit(env, user, "escalation.reason", e.client_id, `SR${e.sr}: expected ${on}`);
    const p = syncEscalations(env, e.client_id, [e.day.slice(0, 7)]); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
    return { ok: true };
  },
  "escalations.count": async ({ env, user }) => {
    const rows = await all(env, `SELECT client_id, created_at, delay_reason, expected_on FROM escalations WHERE status != 'resolved'${scopeSql(user, "client_id")}`, ...scopeArgs(user));
    const now = Date.now(), today = istISO(now);
    const reason = isSME(user) ? 0 : rows.filter((e) => escPast(e.created_at, now) && !e.delay_reason && leadFor(user, e.client_id)).length;
    return { open: rows.length, needs_reason: reason, past_expected: rows.filter((e) => e.expected_on && e.expected_on < today).length };
  },
  /* ---- Team tasks (Needs attention › Team tasks; My tasks for the people given them) ---- */
  "tasks.count": async ({ env, user }) => {
    const now = Date.now(), today = istISO(now), week = now - 7 * 86400000;
    const mine = await all(env, `SELECT p.seen_at, t.due_at, t.hold_until FROM team_task_people p JOIN team_tasks t ON t.id = p.task_id WHERE p.user_id = ? AND t.status = 'open' AND p.status <> 'completed'`, user.id);
    const recent = await one(env, `SELECT COUNT(*) AS n FROM team_task_people p JOIN team_tasks t ON t.id = p.task_id WHERE p.user_id = ? AND (p.completed_at > ? OR t.closed_at > ?)`, user.id, week, week);
    const held = (r) => !!r.hold_until && r.hold_until >= today;
    return { open: mine.length, late: mine.filter((r) => r.due_at < now && !held(r)).length, unseen: mine.filter((r) => !r.seen_at).length, any: mine.length + ((recent && recent.n) || 0) };
  },
  "tasks.list": async ({ env, user, payload }) => {
    if (user.role !== "supervisor") throw denied("Team tasks are for team leads and above.");
    const now = Date.now(), week = now - 7 * 86400000, view = ["open", "done", "all"].includes(payload.view) ? payload.view : "open", cid = payload.client_id ? str(payload.client_id, 60) : "";
    const rows = (await all(env, `SELECT t.*, cl.name AS client_name FROM team_tasks t LEFT JOIN clients cl ON cl.id = t.client_id WHERE (t.status = 'open' OR t.closed_at > ?)${cid ? " AND t.client_id = ?" : ""} ORDER BY t.due_at LIMIT 2000`, now - 30 * 86400000, ...(cid ? [cid] : [])))
      .filter((t) => taskLeadSees(user, t));
    const shaped = await shapeTasks(env, rows, now);
    const open = shaped.filter((t) => t.status === "open"), done = shaped.filter((t) => t.status !== "open"), done7 = done.filter((t) => t.closed_at > week);
    const stats = { open: open.length, items_left: open.reduce((a, t) => a + Math.max(0, t.count - t.done), 0), people: new Set(open.flatMap((t) => t.people.filter((p) => p.status !== "completed").map((p) => p.user_id))).size,
      due_soon: open.filter((t) => t.due_soon).length, late: open.filter((t) => t.late).length, held: open.filter((t) => t.held).length, help: open.filter((t) => t.help).length,
      done_7: done7.length, done_7_in_tat: done7.filter((t) => t.within_tat).length, done: done.length };
    // past the TAT first (the earliest due), then by due time; the ones on hold after the rest; done: the latest first
    const list = view === "open" ? open : view === "done" ? done : shaped;
    list.sort((a, b) => (a.status !== "open") - (b.status !== "open") || (a.held - b.held) || (b.late - a.late) || (a.status === "open" ? a.due_at - b.due_at : b.closed_at - a.closed_at));
    return { rows: list, stats, scopes: TASK_SCOPES, sources: TASK_SOURCES, hold_reasons: TAT_HOLD_REASONS, due_soon_hours: DUE_SOON_HOURS };
  },
  /* The people a team lead can give a task to: their team (as on Team), active; not the people they see only through a view-only share. */
  "tasks.people": async ({ env, user, payload }) => {
    if (user.role !== "supervisor") throw denied("Team tasks are for team leads and above.");
    const cid = payload.client_id ? str(payload.client_id, 60) : "";
    let users = (await visibleUsers(env, user, "edit")).filter((u) => u.active && u.id !== user.id);
    // with a client picked, the people on it first
    const onIt = new Set(); if (cid) { const c = await one(env, "SELECT team_json FROM clients WHERE id = ?", cid); if (c) parseTeam(c.team_json).forEach((id) => onIt.add(id)); }
    users = users.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role, designation: u.designation || "", department: u.department || "", on_client: onIt.has(u.id) }))
      .sort((a, b) => (b.on_client - a.on_client) || (a.role === "user" ? 0 : 1) - (b.role === "user" ? 0 : 1) || a.name.localeCompare(b.name));
    return { people: users };
  },
  "tasks.create": async ({ env, user, payload }) => {
    if (user.role !== "supervisor") throw denied("Team tasks are given by team leads and above.");
    const now = Date.now(), cid = payload.client_id ? str(payload.client_id, 60) : "";
    // a task on a client is a change to that client: a view-only share is not enough (as for escalations)
    if (cid) { const c = await one(env, "SELECT id FROM clients WHERE id = ?", cid); if (!c) throw bad("That client was not found."); editableOr(user, cid); }
    const scope = TASK_SCOPES.includes(payload.scope) ? payload.scope : ""; if (!scope) throw bad("Pick the scope.");
    const title = String(payload.title == null ? "" : payload.title).trim(); if (title.length < 3) throw bad("Write what the task is, a few words."); if (title.length > 160) throw bad("Keep the task name under 160 characters; the rest goes in the description.");
    const description = String(payload.description == null ? "" : payload.description).trim(); if (description.length > TASK_DESC_MAX) throw bad("The description can be up to 4,000 characters.");
    const source = TASK_SOURCES.includes(payload.source) ? payload.source : "";
    const due = taskDueFrom(now, payload.tat);
    const count = Math.round(num(payload.count, 0)); if (!(count >= 1 && count <= 100000)) throw bad("Write how many items the task has: 1 or more.");
    const people = Array.isArray(payload.people) ? payload.people : [];
    if (!people.length) throw bad("Pick who does it.");
    if (people.length > 25) throw bad("Up to 25 people on one task.");
    const team = new Map((await visibleUsers(env, user, "edit")).filter((u) => u.active).map((u) => [u.id, u]));
    const seen = new Set(), list = [];
    for (const p of people) {
      const id = str(p && p.user_id, 60), u = team.get(id);
      if (!u) throw bad("Only people on your team can be given a task.");
      if (seen.has(id)) throw bad((u.name || "Someone") + " is picked twice."); seen.add(id);
      const share = Math.round(num(p && p.share, -1)); if (!(share >= 1)) throw bad("Each person needs a share of at least 1 (or take them off the task).");
      list.push({ u, share });
    }
    const sum = list.reduce((t, x) => t + x.share, 0);
    if (sum !== count) throw bad(`The shares add up to ${sum}, not ${count}: change a share or the count.`);
    const files = taskFilesIn(payload.files);
    const id = uuid(), shares = list.map((x) => (x.u.name || "Someone") + " " + x.share).join(", ");
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO team_tasks (id, client_id, scope, title, description, source, tat_hours, due_at, count_total, created_by, created_by_name, created_at, status, lead_seen_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`).bind(id, cid || null, scope, title, description, source, due.tat_hours, due.due_at, count, user.id, user.name || "", now, now, now),
      ...list.map((x) => env.DB.prepare("INSERT INTO team_task_people (id, task_id, user_id, share, done_n, status) VALUES (?,?,?,?,0,'new')").bind(uuid(), id, x.u.id, x.share)),
      env.DB.prepare("INSERT INTO team_task_updates (id, task_id, user_id, user_name, kind, comment, at) VALUES (?,?,?,?,'created',?,?)").bind(uuid(), id, user.id, user.name || "", `Gave it to ${shares}, TAT ${due.tat_hours} working hours.`, now),
    ]);
    await saveTaskFiles(env, id, null, files, user, now);
    await audit(env, user, "task.create", cid || null, `${scope} · ${count} items · ${shares} · due ${istWhen(due.due_at)}`);
    return { task: { id, due_at: due.due_at, tat_hours: due.tat_hours } };
  },
  "tasks.get": async ({ env, user, payload }) => {
    const now = Date.now();
    const t = await one(env, "SELECT t.*, cl.name AS client_name FROM team_tasks t LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.id = ?", str(payload.id, 60));
    if (!t) throw notFound("That task was not found.");
    const lead = taskLeadSees(user, t), mine = await one(env, "SELECT * FROM team_task_people WHERE task_id = ? AND user_id = ?", t.id, user.id);
    if (!lead && !mine) throw denied("This task is not yours.");
    const [task] = await shapeTasks(env, [t], now);
    let updates = await all(env, "SELECT id, person_id, user_id, user_name, kind, done_n, delta, status, comment, at FROM team_task_updates WHERE task_id = ? ORDER BY at", t.id);
    let files = await all(env, "SELECT id, update_id, name, type, size, user_name, at FROM team_task_files WHERE task_id = ? ORDER BY at", t.id);
    if (!lead) {
      // the person given the task: the task, their own share, their own updates and the team lead's steps (reminders, holds)
      updates = updates.filter((u) => u.kind !== "update" || u.person_id === mine.id);
      const own = new Set(updates.map((u) => u.id)); files = files.filter((f) => !f.update_id || own.has(f.update_id));
      task.people = task.people.filter((p) => p.id === mine.id);
    }
    if (mine && (!mine.seen_at || (mine.reminded_at && mine.reminded_at > mine.seen_at))) await run(env, "UPDATE team_task_people SET seen_at = ? WHERE id = ?", now, mine.id);
    if (lead && t.created_by === user.id) await run(env, "UPDATE team_tasks SET lead_seen_at = ? WHERE id = ?", now, t.id);
    return { task, updates, files, me: mine ? { person_id: mine.id, share: mine.share, done: mine.done_n, status: mine.status } : null, can_lead: lead, hold_reasons: TAT_HOLD_REASONS };
  },
  "tasks.mine": async ({ env, user }) => {
    const now = Date.now(), week = now - 7 * 86400000, today = istISO(now), dayEnd = istDayEnd(today);
    const rows = await all(env, `SELECT p.id AS person_id, p.share, p.done_n, p.status AS my_status, p.updated_at AS my_updated_at, p.completed_at AS my_completed_at, p.seen_at, p.reminded_at, t.*, cl.name AS client_name
      FROM team_task_people p JOIN team_tasks t ON t.id = p.task_id LEFT JOIN clients cl ON cl.id = t.client_id
      WHERE p.user_id = ? AND ((t.status = 'open' AND p.status <> 'completed') OR p.completed_at > ? OR t.closed_at > ?) ORDER BY t.due_at LIMIT 500`, user.id, week, week);
    const files = new Map();
    for (const part of chunks(rows.map((r) => r.id), 80)) for (const f of await all(env, `SELECT task_id, COUNT(*) AS n FROM team_task_files WHERE task_id IN (${part.map(() => "?").join(",")}) AND update_id IS NULL GROUP BY task_id`, ...part)) files.set(f.task_id, f.n);
    const out = rows.map((r) => {
      const todo = r.status === "open" && r.my_status !== "completed", held = todo && !!r.hold_until && r.hold_until >= today, late = todo && !held && now > r.due_at;
      const doneAt = r.my_completed_at || r.closed_at || null;
      return { person_id: r.person_id, task_id: r.id, title: r.title, description: r.description, scope: r.scope, client_id: r.client_id || null, client_name: r.client_name || "", source: r.source,
        from: r.created_by_name, given_at: r.created_at, due_at: r.due_at, tat_hours: r.tat_hours, share: r.share, done: r.done_n, status: r.my_status, todo, late, held,
        hold: held ? { reason: r.hold_reason, until: r.hold_until } : null, due_today: todo && !late && r.due_at <= dayEnd, due_soon: todo && !held && !late && r.due_at <= addWorkingHours(now, DUE_SOON_HOURS),
        left_wh: todo ? Math.round((now <= r.due_at ? workingHoursBetween(now, r.due_at) : -workingHoursBetween(r.due_at, now)) * 10) / 10 : null,
        used_pct: todo ? Math.max(0, Math.min(100, Math.round(100 * workingHoursBetween(r.created_at, now) / Math.max(0.1, workingHoursBetween(r.created_at, r.due_at))))) : 100,
        updated_at: r.my_updated_at || null, done_at: todo ? null : doneAt, within_tat: todo ? null : !!doneAt && doneAt <= r.due_at, closed_by_lead: r.status !== "open" && r.my_status !== "completed",
        new: todo && !r.seen_at, reminded: todo && !!r.reminded_at && (!r.seen_at || r.reminded_at > r.seen_at), files: files.get(r.id) || 0 };
    }).sort((a, b) => (b.todo - a.todo) || (a.held - b.held) || (b.late - a.late) || (a.todo ? a.due_at - b.due_at : (b.done_at || 0) - (a.done_at || 0)));
    const todo = out.filter((x) => x.todo), done7 = out.filter((x) => !x.todo);
    return { rows: out, stats: { todo: todo.length, items_left: todo.reduce((a, x) => a + Math.max(0, x.share - x.done), 0), due_today: todo.filter((x) => x.due_today).length, late: todo.filter((x) => x.late).length,
      done_7: done7.length, done_7_in_tat: done7.filter((x) => x.within_tat).length } };
  },
  /* The person given the task: how many are done, In progress / Completed / Need help, a comment and files. The team lead gets a
     notice. When everyone on it has completed their share, the task is done. */
  "tasks.update": async ({ env, user, payload }) => {
    const p = await one(env, "SELECT * FROM team_task_people WHERE id = ?", str(payload.person_id, 60));
    if (!p || p.user_id !== user.id) throw denied("This task is not yours.");
    const t = await one(env, "SELECT * FROM team_tasks WHERE id = ?", p.task_id);
    if (!t || t.status !== "open") throw bad("This task is closed: nothing more to update.");
    if (p.status === "completed") throw bad("You marked this task completed. Ask your team lead if it needs more.");
    const done = Math.round(num(payload.done, -1)); if (!(done >= 0 && done <= p.share)) throw bad(`Write how many are done: 0 to ${p.share}.`);
    const status = ["in_progress", "completed", "help"].includes(payload.status) ? payload.status : ""; if (!status) throw bad("Pick In progress, Completed or Need help.");
    const comment = String(payload.comment == null ? "" : payload.comment).trim(); if (comment.length > TASK_COMMENT_MAX) throw bad("The comment can be up to 2,000 characters.");
    if (status === "help" && comment.length < 3) throw bad("Write what you need help with.");
    if (status === "completed" && done < p.share && comment.length < 3) throw bad(`Completed with ${done} of ${p.share} done: write why the rest is not done.`);
    if (status === "in_progress" && done === p.done_n && comment.length < 3) throw bad("Change the count or write a comment.");
    const files = taskFilesIn(payload.files);
    const now = Date.now(), uid = uuid();
    await env.DB.batch([
      env.DB.prepare("UPDATE team_task_people SET done_n = ?, status = ?, updated_at = ?, completed_at = ?, seen_at = COALESCE(seen_at, ?) WHERE id = ?").bind(done, status, now, status === "completed" ? now : null, now, p.id),
      env.DB.prepare("INSERT INTO team_task_updates (id, task_id, person_id, user_id, user_name, kind, done_n, delta, status, comment, at) VALUES (?,?,?,?,?,'update',?,?,?,?,?)").bind(uid, t.id, p.id, user.id, user.name || "", done, done - p.done_n, status, comment, now),
      env.DB.prepare("UPDATE team_tasks SET updated_at = ? WHERE id = ?").bind(now, t.id),
    ]);
    await saveTaskFiles(env, t.id, uid, files, user, now);
    const left = await one(env, "SELECT COUNT(*) AS n FROM team_task_people WHERE task_id = ? AND status <> 'completed'", t.id);
    const closed = !(left && left.n);
    if (closed) await run(env, "UPDATE team_tasks SET status = 'done', closed_at = ?, closed_by_name = ?, updated_at = ? WHERE id = ? AND status = 'open'", now, "everyone completed their share", now, t.id);
    return { ok: true, closed, within_tat: now <= t.due_at };
  },
  "tasks.remind": async ({ env, user, payload }) => {
    const t = await taskForLead(env, user, payload.id);
    if (t.status !== "open") throw bad("This task is closed.");
    const now = Date.now(), only = payload.person_id ? str(payload.person_id, 60) : "";
    const r = await run(env, `UPDATE team_task_people SET reminded_at = ? WHERE task_id = ? AND status <> 'completed'${only ? " AND id = ?" : ""}`, now, t.id, ...(only ? [only] : []));
    const n = changesOf(r); if (!n) throw bad("Everyone on it has completed their share.");
    await run(env, "INSERT INTO team_task_updates (id, task_id, person_id, user_id, user_name, kind, comment, at) VALUES (?,?,?,?,?,'remind',?,?)", uuid(), t.id, only || null, user.id, user.name || "", `Reminder sent to ${n === 1 ? "1 person" : n + " people"}.`, now);
    return { ok: true, reminded: n };
  },
  /* Can't close yet: the reason and the expected date (up to 30 days), off the past-TAT reminders until then. */
  "tasks.hold": async ({ env, user, payload }) => {
    const t = await taskForLead(env, user, payload.id);
    if (t.status !== "open") throw bad("This task is closed.");
    const reason = TAT_HOLD_REASONS.includes(payload.reason) ? payload.reason : ""; if (!reason) throw bad("Pick why it cannot be closed yet.");
    const note = str(payload.note, 500).trim(); if (reason === "Other" && note.length < 3) throw bad("Write the reason.");
    const now = Date.now(), today = istISO(now), until = isoDate(payload.until);
    if (!until || until < today) throw bad("Pick the expected close date: today or later.");
    if (until > istISO(now + 30 * 86400000)) throw bad("The expected close date can be at most 30 days ahead.");
    await env.DB.batch([
      env.DB.prepare("UPDATE team_tasks SET hold_reason = ?, hold_note = ?, hold_until = ?, hold_by_name = ?, updated_at = ? WHERE id = ?").bind(reason, note, until, user.name || "", now, t.id),
      env.DB.prepare("INSERT INTO team_task_updates (id, task_id, user_id, user_name, kind, comment, at) VALUES (?,?,?,?,'hold',?,?)").bind(uuid(), t.id, user.id, user.name || "", `On hold until ${until}: ${reason}${note ? " (" + note + ")" : ""}.`, now),
    ]);
    return { ok: true, until };
  },
  "tasks.unhold": async ({ env, user, payload }) => {
    const t = await taskForLead(env, user, payload.id);
    if (!t.hold_until) throw bad("This task is not on hold.");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE team_tasks SET hold_reason = '', hold_note = '', hold_until = NULL, hold_by_name = '', updated_at = ? WHERE id = ?").bind(now, t.id),
      env.DB.prepare("INSERT INTO team_task_updates (id, task_id, user_id, user_name, kind, comment, at) VALUES (?,?,?,?,'unhold','Hold cleared.',?)").bind(uuid(), t.id, user.id, user.name || "", now),
    ]);
    return { ok: true };
  },
  "tasks.close": async ({ env, user, payload }) => {
    const t = await taskForLead(env, user, payload.id);
    if (t.status !== "open") throw bad("This task is already closed.");
    const comment = String(payload.comment == null ? "" : payload.comment).trim(); if (comment.length > TASK_COMMENT_MAX) throw bad("The comment can be up to 2,000 characters.");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE team_tasks SET status = 'closed', closed_at = ?, closed_by_name = ?, hold_until = NULL, updated_at = ? WHERE id = ?").bind(now, user.name || "", now, t.id),
      env.DB.prepare("INSERT INTO team_task_updates (id, task_id, user_id, user_name, kind, comment, at) VALUES (?,?,?,?,'close',?,?)").bind(uuid(), t.id, user.id, user.name || "", comment || "Closed the task.", now),
    ]);
    await audit(env, user, "task.close", t.client_id || null, `${t.scope} · ${t.count_total} items`);
    return { ok: true };
  },
  /* Edit or reassign: the name, description and due time; each person's share (never below what they have done); add people;
     take off someone who has done nothing yet. */
  "tasks.edit": async ({ env, user, payload }) => {
    const t = await taskForLead(env, user, payload.id);
    if (t.status !== "open") throw bad("This task is closed.");
    const now = Date.now(), stmts = [], notes = [];
    const title = payload.title == null ? t.title : String(payload.title).trim();
    if (title.length < 3) throw bad("Write what the task is, a few words."); if (title.length > 160) throw bad("Keep the task name under 160 characters.");
    const description = payload.description == null ? t.description : String(payload.description).trim(); if (description.length > TASK_DESC_MAX) throw bad("The description can be up to 4,000 characters.");
    let due = { due_at: t.due_at, tat_hours: t.tat_hours };
    // working hours count from when the task was given (the TAT); a date is checked against today
    if (payload.tat) { due = payload.tat.kind === "date" ? taskDueFrom(now, payload.tat) : taskDueFrom(t.created_at, payload.tat); notes.push("due " + istWhen(due.due_at)); }
    const current = await all(env, "SELECT p.*, u.name FROM team_task_people p LEFT JOIN users u ON u.id = p.user_id WHERE p.task_id = ?", t.id);
    let count = t.count_total;
    if (Array.isArray(payload.people)) {
      const team = new Map((await visibleUsers(env, user, "edit")).filter((u) => u.active).map((u) => [u.id, u])), want = new Map();
      for (const p of payload.people) { const id = str(p && p.user_id, 60), share = Math.round(num(p && p.share, -1)); if (want.has(id)) throw bad("Someone is picked twice."); want.set(id, share); }
      for (const c of current) {
        if (!want.has(c.user_id)) { if (c.done_n > 0) throw bad(`${c.name || "Someone"} has done ${c.done_n}: set their share to ${c.done_n} instead of taking them off.`);
          stmts.push(env.DB.prepare("DELETE FROM team_task_people WHERE id = ?").bind(c.id)); notes.push("took off " + (c.name || "someone")); continue; }
        const s = want.get(c.user_id); if (!(s >= 1) || s < c.done_n) throw bad(`${c.name || "Someone"}'s share can't be below ${Math.max(1, c.done_n)}.`);
        if (s !== c.share) { stmts.push(env.DB.prepare("UPDATE team_task_people SET share = ?, status = CASE WHEN status = 'completed' AND done_n < ? THEN 'in_progress' ELSE status END, completed_at = CASE WHEN status = 'completed' AND done_n < ? THEN NULL ELSE completed_at END WHERE id = ?").bind(s, s, s, c.id)); notes.push(`${c.name || "someone"} ${c.share} to ${s}`); }
        want.delete(c.user_id);
      }
      for (const [id, s] of want) { const u = team.get(id); if (!u) throw bad("Only people on your team can be given a task."); if (!(s >= 1)) throw bad("Each person needs a share of at least 1.");
        stmts.push(env.DB.prepare("INSERT INTO team_task_people (id, task_id, user_id, share, done_n, status) VALUES (?,?,?,?,0,'new')").bind(uuid(), t.id, id, s)); notes.push(`gave ${s} to ${u.name || "someone"}`); }
      count = [...payload.people].reduce((a, p) => a + Math.round(num(p && p.share, 0)), 0);
      if (!(count >= 1)) throw bad("The task needs at least one person.");
    }
    if (title !== t.title) notes.push("renamed");
    if (description !== t.description) notes.push("description changed");
    stmts.push(env.DB.prepare("UPDATE team_tasks SET title = ?, description = ?, due_at = ?, tat_hours = ?, count_total = ?, updated_at = ? WHERE id = ?").bind(title, description, due.due_at, due.tat_hours, count, now, t.id));
    if (notes.length) stmts.push(env.DB.prepare("INSERT INTO team_task_updates (id, task_id, user_id, user_name, kind, comment, at) VALUES (?,?,?,?,'edit',?,?)").bind(uuid(), t.id, user.id, user.name || "", "Changed: " + notes.join(", ") + ".", now));
    await env.DB.batch(stmts);
    return { ok: true, count, due_at: due.due_at };
  },
  "tasks.file": async ({ env, user, payload }) => {
    const f = await one(env, "SELECT * FROM team_task_files WHERE id = ?", str(payload.id, 60));
    if (!f) throw notFound("That file was not found.");
    const t = await one(env, "SELECT * FROM team_tasks WHERE id = ?", f.task_id);
    const mine = t && await one(env, "SELECT id FROM team_task_people WHERE task_id = ? AND user_id = ?", t.id, user.id);
    if (!t || !(taskLeadSees(user, t) || mine)) throw denied("This file is not on one of your tasks.");
    if (!taskLeadSees(user, t) && f.update_id) { const u = await one(env, "SELECT person_id FROM team_task_updates WHERE id = ?", f.update_id); if (!u || u.person_id !== mine.id) throw denied("This file is not on one of your tasks."); }
    const parts = await all(env, "SELECT data FROM attachment_parts WHERE attachment_id = ? ORDER BY seq", f.id);
    return { name: f.name, type: f.type, size: f.size, data: parts.map((p) => p.data).join("") };
  },
  /* The Needs attention counts (the tabs, the bell, the menu badge), for one client when the page's Client filter asks.
     A flag on hold (Can't close yet, date not passed) is not counted as over the 48 working hours, the same as the TAT board. */
  "attention.count": async ({ env, user, payload }) => {
    const cid = payload && payload.client_id ? str(payload.client_id, 60) : "", one1 = (col) => (cid ? ` AND ${col} = ?` : ""), cargs = cid ? [cid] : [];
    const now = Date.now(), flagHeld = `EXISTS (SELECT 1 FROM tat_holds t WHERE t.kind = 'flag' AND t.ref_id = claims.id AND t.cleared_at IS NULL AND t.until >= ? AND (t.since IS NULL OR t.since = claims.escalated_at))`;
    const cr = await one(env, `SELECT COUNT(*) AS n FROM handoffs WHERE status = 'client' AND client_sent_at IS NULL${one1("client_id")}${scopeSql(user, "client_id")}`, ...cargs, ...scopeArgs(user));
    const r = await one(env, `SELECT COUNT(*) AS n, SUM(CASE WHEN escalated_at IS NOT NULL AND escalated_at < ? AND NOT ${flagHeld} THEN 1 ELSE 0 END) AS overdue FROM claims WHERE escalated = 1 AND state IN ${ESCALATION_STATES} AND NOT ${BOUNCE_WAITING_SQL("claims")}${one1("client_id")}${scopeSql(user, "client_id")}`,
      subWorkingHours(now, ATTN_TAT_HOURS), istISO(now), ...cargs, ...scopeArgs(user));
    const mine = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", user.id);
    const fd = await one(env, `SELECT COUNT(*) AS n FROM handoffs h WHERE h.status IN ('assistance','back') AND h.done_at > ? AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.claim_id = h.claim_id AND n.kind = 'work' AND n.created_at > h.done_at)
      AND NOT EXISTS (SELECT 1 FROM handoffs h2 WHERE h2.claim_id = h.claim_id AND h2.created_at > h.done_at)${one1("h.client_id")}${scopeSql(user, "h.client_id")}`, now - 30 * 86400000, ...cargs, ...scopeArgs(user));
    // team tasks this person sees: open ones for the tab; past the TAT or someone asking for help count on the badge
    let tk = { open: 0, late: 0, help: 0 };
    if (user.role === "supervisor") {
      const today = istISO(now), lt = (await all(env, `SELECT id, client_id, created_by, due_at, hold_until FROM team_tasks WHERE status = 'open'${cid ? " AND client_id = ?" : ""} LIMIT 2000`, ...cargs)).filter((t) => taskLeadSees(user, t));
      const helpIds = new Set(); for (const part of chunks(lt.map((t) => t.id), 80)) for (const h of await all(env, `SELECT DISTINCT task_id FROM team_task_people WHERE status = 'help' AND task_id IN (${part.map(() => "?").join(",")})`, ...part)) helpIds.add(h.task_id);
      tk = { open: lt.length, late: lt.filter((t) => !(t.hold_until && t.hold_until >= today) && now > t.due_at).length, help: helpIds.size };
    }
    return { n: ((r && r.n) || 0) + ((cr && cr.n) || 0) + ((fd && fd.n) || 0) + tk.late + tk.help, escalations: (r && r.n) || 0, client_to_send: (cr && cr.n) || 0, from_desks: (fd && fd.n) || 0, overdue: (r && r.overdue) || 0, my_desk: (mine && mine.n) || 0,
      tasks: tk.open, tasks_late: tk.late, tasks_help: tk.help };
  },
  /* Supervisor review of anything in Needs attention (a biller's escalation, or a claim a department sent back): four notes
     (why it came, what was reviewed, the findings, the next action) go into the claim history, then it goes to the biller who
     sent it, another biller (first on their list, with a notice), or back to the department that sent it (with the client's TAT). */
  "attention.review": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT * FROM claims WHERE id = ?", str(payload.id, 60));
    if (!c) throw bad("Claim not found.");
    editableOr(user, c.client_id);
    const why = str(payload.why, 1000).trim(), reviewed = str(payload.reviewed, 1000).trim(), findings = str(payload.findings, 2000).trim(), next = str(payload.next, 2000).trim();
    if (why.length < 3) throw bad("Write why it came to you.");
    if (!commentOk(reviewed)) throw bad("Write what you reviewed, a few words at least.");
    if (!commentOk(findings)) throw bad("Write your findings, a few words at least.");
    if (!commentOk(next)) throw bad("Write the next action, a few words at least.");
    const route = ["biller", "other", "dept", "keep"].includes(payload.route) ? payload.route : "";
    if (!route) throw bad("Pick where it goes: the biller who sent it, another biller, or back to the department.");
    if (route === "keep" && c.state !== "closed") throw bad("Only a closed claim can be kept closed: pick where it goes.");
    const now = Date.now(), today = isoDate(payload.today) || isoToday(), cno = c.claim_no || c.account_no || "a claim";
    // The review goes on the claim's timeline only (who escalated it and when, who reviewed it, the four notes, where it went):
    // the claim's notes, work entries and details stay exactly as they were.
    const from = c.escalated ? await one(env, "SELECT name FROM users WHERE id = ?", c.escalated_by) : null;
    const sentBack = c.escalated ? null : await one(env, "SELECT dept, done_by_name, done_at, reason FROM handoffs WHERE claim_id = ? AND status IN ('back','assistance') ORDER BY done_at DESC LIMIT 1", c.id);
    // Only what is in Needs attention: an escalation, or a claim a department sent back that nobody has reviewed since.
    if (!c.escalated && sentBack && c.reviewed_at && c.reviewed_at > sentBack.done_at) throw bad(`This claim was already reviewed${c.reviewed_by_name ? " by " + c.reviewed_by_name : ""} after it was sent back. It stays under Sent back until a biller saves an entry on it.`);
    if (!c.escalated && !sentBack) throw bad("This claim is not waiting for a review: it was not escalated or sent back by a department.");
    const origin = c.escalated ? { by: from ? from.name : "", at: c.escalated_at, how: "escalated" } : sentBack ? { by: sentBack.done_by_name, at: sentBack.done_at, how: "sent back by " + DEPT_LABEL[sentBack.dept], reason: sentBack.reason } : {};
    const stmts = [env.DB.prepare("UPDATE claims SET escalated = 0, escalation_answered_at = ?, escalation_answered_by = ?, reviewed_at = ?, reviewed_by_name = ?, updated_at = ? WHERE id = ?").bind(now, user.id, now, user.name, now, c.id)];
    let to = "", waits = "", reopened = false;
    if (route === "keep") {
      // The team lead agrees with the closure: the claim stays closed and the biller who sent it gets the review as a notice.
      const sender = c.escalated_by || c.last_worked_by || c.assigned_to;
      if (sender) stmts.push(env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)").bind(uuid(), sender, now, `${user.name} reviewed claim ${cno} and kept it closed. ${next}`.slice(0, 300), "queue", c.client_id));
      stmts.push(claimEvent(env, c.id, user, "review_to_biller", "kept closed", { why, reviewed, findings, next, origin, kept: true }));
      to = "kept closed";
    } else if (route === "dept") {
      const dept = ["posting", "submission", "rejection"].includes(payload.dept) ? payload.dept : "";
      if (!dept) throw bad("Pick the department to send it back to.");
      const cl = await one(env, "SELECT * FROM clients WHERE id = ?", c.client_id);
      const people = await deskPeople(env, cl, dept);
      if (!people) throw bad(`${DEPT_LABEL[dept]} has no active responsible person on this client's profile.`);
      if (await one(env, "SELECT id FROM handoffs WHERE claim_id = ? AND dept = ? AND status IN ('pending','assigned','client')", c.id, dept)) throw bad(`It is already open with ${DEPT_LABEL[dept]}.`);
      const due = addWorkingHours(now, tatHours(cl, dept));
      const prev = await one(env, "SELECT biller_id FROM handoffs WHERE claim_id = ? AND biller_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", c.id);
      stmts.push(env.DB.prepare(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, saag_action, due_at, lead_id, backup_id, note, biller_id) VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)`)
        .bind(uuid(), c.id, c.client_id, dept, now, user.id, user.name, "Returned after supervisor review", due, people.lead, people.backup, next, c.assigned_to || c.last_worked_by || (prev && prev.biller_id) || null));
      stmts.push(env.DB.prepare("UPDATE claims SET handoff_status = ?, state = ?, state_reason = ?, follow_up_on = '', first_up = 0 WHERE id = ?").bind("with_" + dept, IN_PROCESS, "With " + DEPT_LABEL[dept], c.id));
      stmts.push(env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)").bind(uuid(), people.lead, now, `${user.name} reviewed claim ${cno} and returned it to ${DEPT_LABEL[dept]}: ${next}`.slice(0, 300), "handoffs", c.client_id));
      stmts.push(claimEvent(env, c.id, user, "review_to_dept", DEPT_LABEL[dept], { dept, why, reviewed, findings, next, due_at: due, origin }));
      to = DEPT_LABEL[dept];
    } else {
      let target = str(payload.user_id, 60);
      if (route === "biller") {
        // "The biller who sent it" is someone on this claim's record (who flagged it, whose list it is on, who last worked it, or
        // the biller of one of its hand-offs): a name sent by the page is used only when it is one of them.
        const hs = await all(env, "SELECT biller_id, created_by FROM handoffs WHERE claim_id = ?", c.id);
        const onRecord = new Set([c.escalated_by, c.assigned_to, c.last_worked_by, ...hs.map((h) => h.biller_id), ...hs.map((h) => h.created_by)].filter(Boolean));
        const asked = str(payload.sent_by, 60);
        target = asked && onRecord.has(asked) ? asked : str(c.escalated_by || c.assigned_to || c.last_worked_by || "", 60);
      }
      // "The biller who sent it" is an AR biller: never the Posting / Submission person who returned the claim (older bounces named them).
      const tu = route === "biller" && target ? await one(env, "SELECT * FROM users WHERE id = ?", target) : null;
      if (tu && userDesk(publicUser(tu))) {
        const hb = await one(env, "SELECT biller_id FROM handoffs WHERE claim_id = ? AND biller_id IS NOT NULL AND biller_id <> ? ORDER BY created_at DESC LIMIT 1", c.id, target);
        target = (hb && hb.biller_id) || (c.assigned_to !== target ? c.assigned_to : "") || "";
      }
      const b = target ? await one(env, "SELECT id, name FROM users WHERE id = ? AND active = 1", target) : null;
      if (!b) throw bad(route === "biller" ? "The biller who sent it is not active any more: pick another biller." : "Pick the biller.");
      // The same rule as allocation: an active AR biller whose projects include the claim's client.
      if (!(await billerFor(env, b.id, c.client_id))) throw bad(route === "biller" ? `${b.name} is not an active AR biller on this client any more: pick another biller.` : `${b.name} cannot be given this claim: pick an active AR biller on the claim's client.`);
      // A claim still with Posting / Submission / Rejections stays there: it comes to this biller when the desk finishes.
      const atDesk = c.state === IN_PROCESS ? await one(env, "SELECT dept FROM handoffs WHERE claim_id = ? AND dept <> 'subcheck' AND status IN ('pending','assigned','client') ORDER BY created_at DESC LIMIT 1", c.id) : null;
      if (atDesk) {
        stmts.push(env.DB.prepare("UPDATE claims SET assigned_to = ?, assigned_at = CASE WHEN assigned_to = ? THEN assigned_at ELSE ? END, skipped_at = NULL WHERE id = ?").bind(b.id, b.id, now, c.id));
        // the open hand-offs follow this biller: the desk's notices and the recheck after a submission go to them, and when
        // Submission or Rejections finish the claim goes on their list (handoffs.close looks for this review)
        stmts.push(env.DB.prepare("UPDATE handoffs SET biller_id = ? WHERE claim_id = ? AND status IN ('pending','assigned','client')").bind(b.id, c.id));
        const then = atDesk.dept === "posting" ? "It is with Payment Posting now, which closes it once the payment is posted (if they send it back, it is first on your list)."
          : `It is with ${DEPT_LABEL[atDesk.dept]} now and comes to your list when they finish.`;
        stmts.push(env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)").bind(uuid(), b.id, now, `${user.name} reviewed claim ${cno} and gave it to you. ${then} Next action: ${next}`.slice(0, 300), "queue", c.client_id));
      } else {
        // A closed claim the team lead sends to a biller is opened again: it is first on their list, as the notice says.
        stmts.push(env.DB.prepare(`UPDATE claims SET assigned_to = ?, assigned_at = CASE WHEN assigned_to = ? THEN assigned_at ELSE ? END,
            state = CASE WHEN state IN ('open','assigned','in_progress','completed','closed','in_process') THEN 'assigned' ELSE state END,
            state_reason = CASE WHEN state IN ('closed','in_process') THEN 'Opened again after supervisor review' ELSE state_reason END, follow_up_on = ?, skipped_at = NULL, first_up = 1 WHERE id = ?`).bind(b.id, b.id, now, today, c.id));
        stmts.push(env.DB.prepare("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)").bind(uuid(), b.id, now, `${user.name} reviewed claim ${cno} and gave it to you, first on your list. Next action: ${next}`.slice(0, 300), "queue", c.client_id));
      }
      stmts.push(claimEvent(env, c.id, user, "review_to_biller", b.name, { why, reviewed, findings, next, origin, waits: atDesk ? atDesk.dept : "", reopened: c.state === "closed" }));
      to = b.name; waits = atDesk ? DEPT_LABEL[atDesk.dept] : ""; reopened = c.state === "closed";
    }
    await env.DB.batch(stmts);
    await audit(env, user, "attention.review", c.client_id, `${cno}: to ${to}`);
    return { ok: true, to, waits, reopened };
  },
  /* The billers a reviewed claim may go to: active AR billers on the claim's client (the same rule as allocation). */
  "attention.reviewPeople": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id FROM claims WHERE id = ?", str(payload.id, 60));
    if (!c) throw bad("Claim not found.");
    if (!inScope(user, c.client_id)) throw outOfScope();
    const out = [];
    for (const p of await reviewPeople(env, user)) if (await billerFor(env, p.id, c.client_id)) out.push(p);
    return { people: out };
  },
  /* Resubmitted claims waiting on the recheck (accepted or rejected again?), for the biller who worked them, with the TAT. */
  "handoffs.myRechecks": async ({ env, user }) => {
    const rows = await all(env, `SELECT h.id, h.claim_id, h.client_id, h.dept, h.status, h.created_at, h.created_by_name, h.saag_action, h.due_at, h.available_at, h.from_dept, h.assigned_to, a.name AS check_name,
        c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, cl.name AS client_name
      FROM handoffs h JOIN claims c ON c.id = h.claim_id LEFT JOIN clients cl ON cl.id = h.client_id LEFT JOIN users a ON a.id = h.assigned_to
      WHERE h.dept = 'subcheck' AND h.status IN ('pending','assigned','client') AND (h.biller_id = ? OR (h.biller_id IS NULL AND (c.assigned_to = ? OR c.last_worked_by = ?)))
      ORDER BY h.due_at ASC LIMIT 200`, user.id, user.id, user.id);
    const now = Date.now();
    return { rows: rows.map((r) => ({ ...r, from_label: DEPT_LABEL[r.from_dept] || "Submission", open: !r.available_at || now >= r.available_at, overdue: now > r.due_at,
      due_soon: now <= r.due_at && r.due_at <= addWorkingHours(now, DUE_SOON_HOURS), left_ms: r.due_at - now,
      left_wh: Math.round((now <= r.due_at ? workingHoursBetween(now, r.due_at) : -workingHoursBetween(r.due_at, now)) * 10) / 10 })), reject_codes: REJECT_CODES };
  },
  /* Answer an escalation: the reply goes into the claim history and the flag comes off. Optionally the claim goes back on the biller's list today. */
  "attention.answer": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, assigned_to, state, escalated FROM claims WHERE id = ?", str(payload.id, 60));
    if (!c) throw bad("Claim not found.");
    editableOr(user, c.client_id);
    if (!c.escalated) throw bad("This claim is not escalated (or the escalation was already answered).");
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
  /* Pull the roster from Purview Shastra now (the same as the hourly run). */
  "roster.syncShastra": async ({ env, user }) => syncShastra(env, user.name || user.email),
  "roster.meta": async ({ env }) => {
    const meta = await getSetting(env, "roster_meta", null);
    const extra = (await getSetting(env, "extra_emails", [])) || [];
    const clients = await all(env, "SELECT id, name, roster_names_json FROM clients ORDER BY name");
    const names = await rosterProjectNames(env);
    const projects = names.map((name) => { const c = clients.find((x) => jsonList(x.roster_names_json).some((n) => projKey(n) === projKey(name))); return { name, client_id: c ? c.id : null, client_name: c ? c.name : "" }; });
    return { meta, extra_emails: extra, projects, admins: adminEmails(env),
      shastra: { connected: !!env.SHASTRA_FEED_KEY, last: await getSetting(env, "shastra_sync", null), log: (await getSetting(env, "shastra_log", [])) || [] } };
  },
  "roster.saveEmails": async ({ env, user, payload }) => {
    const list = [...new Set((Array.isArray(payload.emails) ? payload.emails : String(payload.emails || "").split(/[\s,;]+/)).map(mailClean).filter(mailOk))].slice(0, 200);
    const old = ((await getSetting(env, "extra_emails", [])) || []).map(mailClean);
    await setSetting(env, "extra_emails", list);
    // these addresses may sign in without a Purview email: who let them in, or took them off, is kept
    const added = list.filter((x) => !old.includes(x)), removed = old.filter((x) => !list.includes(x));
    if (added.length || removed.length) await audit(env, user, "roster.emails", null, [added.length ? "added " + added.join(", ") : "", removed.length ? "removed " + removed.join(", ") : ""].filter(Boolean).join("; "));
    return { extra_emails: list };
  },

  /* ---- roster projects ↔ Brahmastra clients ---- */
  "projects.unmapped": async ({ env, user }) => {
    const clients = await all(env, "SELECT id, name, code, roster_names_json, created_by FROM clients WHERE active = 1 ORDER BY name");
    const mapped = new Set(clients.flatMap((c) => jsonList(c.roster_names_json).map(projKey)));
    const mine = user.scope ? new Set(user.scope_projects.map(projKey)) : null;
    const names = (await rosterProjectNames(env)).filter((n) => !mapped.has(projKey(n)) && (!mine || mine.has(projKey(n))));
    // the clients offered are the ones projects.map takes: for a team lead, the clients of their own span
    return { names, clients: clients.filter((c) => ownClient(user, c)).map((c) => ({ id: c.id, name: c.name, code: c.code })) };
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
    const c = await one(env, "SELECT id, name, roster_names_json, created_by FROM clients WHERE id = ?", clientId);
    if (!c) throw bad("Pick the client this project is.");
    const others = await all(env, "SELECT id, name, roster_names_json FROM clients");
    const from = others.find((o) => o.id !== c.id && jsonList(o.roster_names_json).some((n) => projKey(n) === projKey(name)));
    if (user.scope && !payload.create) {
      // A team lead matches their own project only to a client of their own span (ownClient): never to one that was shared with
      // them, or that just has no roster project yet (everyone on the project would get its claims). And moves it off a client only
      // when they may change that client too. Anything else is the admin's call.
      if (!ownClient(user, c)) throw denied("You can match your project only to a client you are responsible for. Ask your admin to match it to this one.");
      if (from) editableOr(user, from.id);
    }
    let changed = !!payload.create;
    for (const o of others) {
      const list = jsonList(o.roster_names_json).filter((n) => projKey(n) !== projKey(name));
      if (o.id === c.id) list.push(name);
      if (JSON.stringify(list) !== o.roster_names_json) { await run(env, "UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(list), o.id); changed = true; }
    }
    await syncTeams(env);
    // who sees a client follows from this match, so it goes in the audit trail
    if (changed) await audit(env, user, "project.map", c.id, `Roster project ${name} matched to ${c.name}` + (payload.create ? " (a new client)" : "") + (from ? `; it was on ${from.name}` : ""));
    return { ok: true, client_id: c.id };
  },

  /* ---- the day's team for a project: who receives claims today, and how many each ---- */
  /* Who gets this client's (or location's) claims today: its people (the location's own team when it has one), each up
     to their daily target, minus anyone marked out today in Team today. */
  "team.today": async ({ env, payload }) => {
    const c = await one(env, "SELECT id, name, team_json, caps_json, roster_names_json FROM clients WHERE id = ?", payload.client_id);
    if (!c) throw bad("Unknown client.");
    const day = isoDate(payload.day) || isoToday();
    const loc = payload.location_id ? await one(env, "SELECT team_json FROM locations WHERE id = ? AND client_id = ?", str(payload.location_id, 60), c.id) : null;
    const ids = loc && parseTeam(loc.team_json).length ? parseTeam(loc.team_json) : parseTeam(c.team_json);
    const users = ids.length ? await all(env, `SELECT * FROM users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")}) ORDER BY name`, ...ids) : [];
    const caps = jsonObj(c.caps_json);
    const saved = await one(env, "SELECT a.on_json, a.at, u.name AS by_name FROM availability a LEFT JOIN users u ON u.id = a.by_user WHERE a.client_id = ? AND a.day = ?", c.id, day);
    const on = saved ? jsonList(saved.on_json) : null;
    const names = new Set(jsonList(c.roster_names_json).map(projKey));
    const members = users.map((u) => { const p = jsonList(u.projects_json).find((x) => names.has(projKey(x.name)));
      return { id: u.id, name: u.name, designation: u.designation || "", status: u.roster_status || "", exit_date: u.exit_date || "", share: p ? p.share : null, primary: !!(p && p.share == null),
        cap: caps[u.id] != null ? caps[u.id] : u.capacity, cap_set: caps[u.id] != null, on: on ? on.includes(u.id) : true }; });
    // on_ids: everyone ticked for the day (Allocate can tick people outside the project team too); caps: numbers set per person.
    const out = new Set(ids.length ? (await all(env, `SELECT user_id FROM attendance WHERE day = ? AND status = 'out' AND user_id IN (${ids.map(() => "?").join(",")})`, day, ...ids)).map((r) => r.user_id) : []);
    members.forEach((m) => { m.out = out.has(m.id); m.cap = m.cap || 35; });
    return { client: { id: c.id, name: c.name }, day, members, on_ids: on, caps, saved: saved ? { at: saved.at, by_name: saved.by_name || "" } : null };
  },
  "team.saveToday": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, team_json, caps_json FROM clients WHERE id = ?", payload.client_id);
    if (!c) throw bad("Unknown client.");
    const day = isoDate(payload.day) || isoToday();
    // Anyone active can be ticked for the day: the project team from the pop-up, or anyone the team lead picks on Allocate.
    const active = new Set((await all(env, "SELECT id FROM users WHERE active = 1")).map((u) => u.id));
    const on = [...new Set((Array.isArray(payload.on) ? payload.on : []).map((x) => str(x, 60)))].filter((x) => active.has(x));
    const caps = jsonObj(c.caps_json);
    for (const [id, v] of Object.entries(payload.caps || {})) if (active.has(id)) caps[id] = Math.max(0, Math.min(500, Math.round(num(v, 35))));
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

/* The same patient: the same account number when both claims have one; the name only when one of them has no account number
   (two patients with the same name are told apart by their account numbers). */
const samePatientSql = (p = "") => `((${p}account_no <> '' AND ${p}account_no = ?) OR (${p}patient <> '' AND ${p}patient = ? AND (${p}account_no = '' OR ? = '')))`;
const samePatientArgs = (c) => [c.account_no || "\u0000", c.patient || "\u0000", c.account_no || ""];
async function claimBundle(env, user, c, opts = {}) {
  const notes = await all(env, "SELECT * FROM notes WHERE claim_id = ? ORDER BY created_at DESC LIMIT 200", c.id);
  const files = await all(env, "SELECT id, claim_id, user_id, user_name, name, type, size, created_at FROM attachments WHERE claim_id = ? ORDER BY created_at DESC LIMIT 200", c.id);
  // a reader (someone who may only read a claim Posting closed) sees this claim alone, not the patient's other claims
  const key = opts.viewOnly ? "" : c.account_no || c.patient, locked = postedClosed(c);
  const siblings = key ? await all(env, `SELECT id, claim_no, account_no, patient, dos, cpt, payer, balance, state, assigned_to, priority, follow_up_on, last_status_code FROM claims
      WHERE client_id = ? AND id <> ? AND state IN ${WORKABLE} AND ${samePatientSql()} ORDER BY priority DESC LIMIT 50`, c.client_id, c.id, ...samePatientArgs(c)) : [];
  let lines = []; try { lines = JSON.parse(c.lines_json || "[]"); } catch {}
  let raw = {}; try { raw = JSON.parse(c.raw_json || "{}"); } catch {}
  const { raw_json, lines_json, ...rest } = c;
  const now = Date.now();
  const edNames = await namesOf(env, notes.map((n) => n.edited_by));
  const shaped = notes.map((n) => { const { fields_json, ...nn } = n; return { ...nn, fields: noteFields(n), edited_by_name: (n.edited_by && edNames.get(n.edited_by)) || "", editable: !locked && n.kind === "work" && (n.user_id === user.id || leadFor(user, c.client_id)), edit_until: n.created_at + EDIT_WINDOW_MS }; });
  const handoffs = await all(env, `SELECT h.*, l.name AS lead_name, b.name AS backup_name, a.name AS assigned_name FROM handoffs h LEFT JOIN users l ON l.id = h.lead_id LEFT JOIN users b ON b.id = h.backup_id
      LEFT JOIN users a ON a.id = h.assigned_to WHERE h.claim_id = ? ORDER BY h.created_at DESC LIMIT 10`, c.id);
  const role = await handoffRole(env, user, c.id);
  const limits = payerKey(c.payer) ? await one(env, "SELECT tfl_days, afl_days, note, updated_at, updated_by_name FROM payer_limits WHERE client_id = ? AND payer_key = ?", c.client_id, payerKey(c.payer)) : null;
  const attachments = files.map((a) => ({ ...a, deletable: !locked && (leadFor(user, c.client_id) || (a.user_id === user.id && now - a.created_at <= EDIT_WINDOW_MS)) }));
  // whether this client has an active Posting / Submission / Rejections person (the same rule as queue.complete): a claim sent
  // there leaves AR with no follow-up date until the desk is done
  const dc = await one(env, `SELECT ${["posting", "submission", "rejection"].map((d) => `${d}_mode, ${d}_lead, ${d}_backup`).join(", ")}, subcheck_hours FROM clients WHERE id = ?`, c.client_id);
  const [dp, ds, dr] = await Promise.all(["posting", "submission", "rejection"].map((d) => deskPeople(env, dc, d)));
  return { claim: { ...rest, lines, raw, mine: c.assigned_to === user.id, payer_limits: limits || null, desk_posting: !!dp, desk_submission: !!ds, desk_rejection: !!dr, recheck_hours: subcheckHours(dc), locked, view_only: !!opts.viewOnly }, notes: shaped, attachments, siblings,
    handoffs: handoffs.map((h) => ({ ...h, proof: jsonObj(h.proof_json), proof_json: undefined, overdue: ["pending", "assigned"].includes(h.status) && Date.now() > h.due_at })), handoff_role: role, payer_limits: limits || null };
}

/* ------------------------------------------------------------ fetch */
export default {
  // Every hour: the roster from Purview Shastra (only once SHASTRA_FEED_KEY is set).
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil((async () => {
      try { await ensureReady(env); await loadHolidays(env); await snapshotClients(env); await setSetting(env, "snap_at", Date.now()); } catch (e) { console.log("Snapshot: " + (e && e.message)); }
      if (env.MS_CLIENT_SECRET && String(env.REPORTS_AUTO || "on").toLowerCase() !== "off") {
        try { const tok = await graphAppToken(env); for (const r of await all(env, "SELECT id FROM clients WHERE active = 1 AND (od_production_id IS NULL OR od_production_id = '' OR od_prod_json NOT LIKE '%rejection%') ORDER BY COALESCE(CASE WHEN json_valid(od_status_json) THEN json_extract(od_status_json, '$.at') END, 0), name LIMIT 8")) { try { await ensureClientFolders(env, r.id, tok); } catch (e) { console.log("Folders: " + (e && e.message)); } } } catch (e) { console.log("Folders: " + (e && e.message)); }
      }
      try { await escalationReminders(env); } catch (e) { console.log("Escalation reminders: " + (e && e.message)); }
      // TAT reminders, Monday to Friday: Posting, Submission and Rejections at 09:00 IST, AR at 19:00 IST (and the hourly runs retry a failed send for 3 hours)
      try { await tatMonthFiles(env); } catch (e) { console.log("TAT report files: " + (e && e.message)); }
      try { await escMonthFiles(env); } catch (e) { console.log("Escalation files: " + (e && e.message)); }
      if (env.EMAIL_PROVIDER && !env.DEMO) { try { const r = await sendTatReminders(env); if (r.kind && (r.sent || r.failed)) console.log(`TAT reminders ${r.kind} ${r.day}: ${r.sent} sent, ${r.failed} failed`); } catch (e) { console.log("TAT reminders: " + (e && e.message)); } }
      if (env.SHASTRA_FEED_KEY && event.cron !== DIGEST_CRON) { try { await syncShastra(env, "hourly"); } catch (e) { console.log("Shastra sync: " + (e && e.message)); } }
      // Monday mornings (IST): this week's digest, a few clients per run until every client has had it
      // only the Monday job sends it (the hourly run falls inside the same hours and could send it twice)
      if (env.EMAIL_PROVIDER && event.cron === DIGEST_CRON && digestDue(Date.now()) && (await getSetting(env, "digest_enabled", true)) !== false) {
        try { const r = await sendDigests(env, { limit: Math.max(1, Math.min(20, Number(env.DIGEST_BATCH) || 3)) }); if (r.spans) console.log(`Digest ${r.week}: ${r.spans} spans, ${r.sent} sent, ${r.failed} failed, ${r.left} left`); } catch (e) { console.log("Digest: " + (e && e.message)); }
      }
    })());
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (!env.DB) throw new ApiError(500, "No D1 database is bound as DB. Add the binding in the Worker settings.");
      await ensureReady(env);
      await loadHolidays(env);
      if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, app: "brahmastra-api", version: VERSION });
      if (url.pathname === "/api" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { throw bad("Send a JSON body like {op, payload}."); }
        const op = String(body && body.op || "");
        const payload = (body && body.payload) || {};
        // Ids are text (or numbers): an object or a list would reach the database and fail there.
        for (const k of Object.keys(payload)) if ((k === "id" || k.endsWith("_id")) && payload[k] !== null && typeof payload[k] === "object") throw bad("Send " + k + " as text.");
        // JSON can send an object with its own "toString" or "valueOf" (as a number, say): it cannot be read as text, and would crash
        // whichever op turns it into text. Refused here, at any depth, before any op runs.
        if (unreadable(payload)) throw bad("Send plain values: text, numbers, yes or no, or lists of them.");
        const auth = request.headers.get("Authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        // Only the ops themselves: OPS["constructor"], "__proto__", "toString" and the like are inherited from every object.
        const handler = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
        if (!handler) throw new ApiError(404, "Unknown operation: " + op);
        const user = await userFromToken(env, token);
        if (!PUBLIC_OPS.has(op) && !user) throw new ApiError(401, "Please sign in.");
        if (user && user.must_change && !["auth.changePassword", "auth.me", "auth.logout", "auth.deleteMyAccount", "meta.info"].includes(op)) throw new ApiError(403, "Please set a new password first.");
        if (SUPERVISOR_OPS.test(op) && (!user || user.role !== "supervisor") && !(user && DESK_READ_OPS.test(op))) throw denied("Supervisor access is needed for this.");
        if (ADMIN_OPS.test(op) && (!user || !user.is_admin)) throw denied("Admin access is needed for this.");
        if (user && deskOf(user) && DESK_NOT.test(op)) throw denied("That is AR's work. Your desk is " + DESK_NAME[deskOf(user)] + ": you see the claims sent to it.");
        if (user) {
          user.scope = await scopeOf(env, user);
          // Matching a roster project to a client is how a client comes into scope, so that one call is exempt.
          if (user.scope && user.role === "supervisor" && payload.client_id && op !== "projects.map" && !user.scope.includes(String(payload.client_id))) throw outOfScope();
          // Changing a client's data needs edit access; a view-only share is not enough.
          if (user.scope_view_only && user.scope_view_only.size && payload.client_id && EDIT_OPS.test(op) && user.scope_view_only.has(String(payload.client_id))) throw viewOnly();
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
      // Our own errors say what to do; anything unexpected is not shown as is (it can carry internals).
      return json({ error: (e instanceof ApiError && e.message) || "Server error." }, status);
    }
  },
};
