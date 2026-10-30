# Purview Brahmastra

Claim allocation and follow-up console for the AR team.

A **team lead** sets up clients and their locations, uploads inventory
(fresh, or previously worked), and hands claims out to billers using the
Revenue Doctor's prioritisation rules. A **biller** sees the day's
allocations in priority order, opens one claim at a time, records the SAAG
entry (Status › Sub-status › Action, with the bucket) and the standard note,
and moves on. Every entry is kept on the claim's profile, can be edited for 24
hours, and can be exported as one cell per note.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app (React, loaded from CDNs). Host it anywhere static: GitHub Pages, Cloudflare Pages. |
| `worker.js` | The API: a Cloudflare Worker on a D1 (SQLite) database. One file, no build step. |
| `lib/saag.js` | The SAAG matrix (8 statuses, 96 sub-statuses, 50 actions, their Effective Matrix), generated from the SAAG Claim Entry Tool workbook. |
| `lib/denial-library.js` | The denial library from Purview Gurukul (72 denial scenarios: meaning, questions for the payer, next steps). Drives the "Suggested next steps" panel. |
| `lib/local-backend.js` | Demo mode only: runs `worker.js` inside the browser on SQLite-in-WebAssembly so the app works with no server. |
| `lib/msal-browser.js`, `lib/msal-redirect-bridge.js` | Microsoft's MSAL 5.22 (as shipped in the previous Brahmastra) for the OneDrive picker. |
| `dev/build-saag.ps1` | Regenerates `lib/saag.js` from a new copy of the workbook. |
| `dev/build-denial-library.ps1` | Refreshes `lib/denial-library.js` from Gurukul's `index.html`. |
| `dev/serve.ps1` | A tiny local web server (PowerShell, no Node needed) for trying the app on a PC. |
| `wrangler.toml` | Tells Cloudflare how to deploy the Worker: its name, the D1 database binding and the plain variables. Used by Cloudflare Workers Builds on every push. |

Claim files are never committed (see `.gitignore`).

## Try it in two minutes (demo mode)

Demo mode is on whenever `API_BASE` in `index.html` is empty. The API runs
inside your browser and the data stays on that one device (IndexedDB). Use a
single browser tab for the demo.

1. Open the app through a web address (GitHub Pages, Cloudflare Pages, or
   locally: `powershell -ExecutionPolicy Bypass -File dev\serve.ps1` then
   http://localhost:8787/). Opening the file directly from disk does not work,
   because browsers block the module loads.
2. Sign in as `supervisor@purview-healthcare.com` / `brahmastra-demo`, or press
   **Load sample data** to get three billers (Aisha, Rohan, Priya, same
   password), two clients with locations, fresh and previously-worked
   inventory, and a first allocation.
3. Sign out and sign in as `aisha@purview-healthcare.com` / `brahmastra-demo`
   to see a biller's day.

**Reset demo data** on the sign-in screen wipes the demo database.

## Go live

### 1. The API (Cloudflare Worker `brahmastra-api`)

The Worker is deployed by **Cloudflare Workers Builds** straight from this
repository: the Worker's **Settings → Builds** is connected to
`Purview-Healthcare/brahmastra` (branch `main`, deploy command
`npx wrangler deploy`). Every push to `main` therefore updates both the site
(GitHub Pages) and the API (Cloudflare) within a couple of minutes; the build
log is under the Worker's **Deployments** tab.

`wrangler.toml` carries everything the build needs: the Worker name, the D1
database binding `DB` → `brahmastra` (its `database_id`), and the plain
variables `BOOTSTRAP_EMAIL` and `ALLOWED_DOMAINS` (`*purview*` = any email
domain that contains "purview"). Secrets are not in the repository; add them
once under **Worker → Settings → Variables and secrets** (they survive every
deploy):

- `PEPPER` (secret): any long random text, mixed into every password hash and
  sign-in code. Accounts created before it was set keep working (their hash
  is upgraded at their next sign-in), but do not change it once set.
- `BOOTSTRAP_PASSWORD` (secret, optional): the first team lead's first
  password. Without it the first team lead is
  `supervisor@purview-healthcare.com` / `brahmastra-setup` and must change the
  password at first sign-in.

`https://brahmastra-api.<your-account>.workers.dev/health` answers
`{"ok":true,...}` once the Worker is live. The tables are created on the first
request, and later versions add any new columns on their own.

To set it up again from nothing: **Workers & Pages → D1 → Create database**
(`brahmastra`, copy its id into `wrangler.toml`), **Create → Worker**
(`brahmastra-api`), then **Settings → Builds → Connect** to this repository.
Without Workers Builds you can also paste `worker.js` into the dashboard
editor and add the D1 binding by hand, or run `npx wrangler deploy` locally.

### 2. Point the app at it

In `index.html`, near the top:

```js
window.BRAHMASTRA_CONFIG = {
  API_BASE: "https://brahmastra-api.<your-account>.workers.dev",
  ALLOWED_DOMAINS: ["purview-healthcare.com", "purviewservices.com"],
};
```

Commit and push; GitHub Pages (or Cloudflare Pages) serves it. The site needs
`index.html` and the `lib/` folder.

### 3. First sign-in

Sign in with the bootstrap team lead, open **Team** and create the billers
(each gets a temporary password shown once; they choose their own on first
sign-in), then **Clients** and **Inventory**.

## How it works

### Roles

- **Team lead**: Dashboard, Inventory, Allocate, Claims, Team, Clients, SAAG,
  Reports, and a day list of their own.
- **Biller**: My day (the allocations, one claim at a time) and My work (their
  history).
- **Admin** (`ADMIN_EMAILS` in `wrangler.toml`, signs in with an email code):
  everything a team lead has, plus the **Roster** screen.

### Roster (Purview Shastra)

The admin loads the Shastra export (CSV or Excel) on the Roster screen, checks
the preview and applies it. People are matched by Emp ID (then email, then
name) and their department, projects, manager and status are kept.

- Agents become billers; SMEs, Team Leads and Sr Team Leads become team leads
  for their own projects; Assistant Managers, Managers and Sr Managers become
  team leads for their projects and every project of the people below them;
  the Vice President sees every project. CEO, Director, HR, IT, Administration,
  QA, MIS and Tech Support get no access.
- Each roster project is matched to a client (same name or code automatically;
  otherwise a team lead is asked once). Active AR agents on a project become
  that client's billers.
- After sign-in, a TL or SME is asked who works each of their projects today and
  how many claims each person should get. Automatic allocation and the Allocate
  screen use those ticks and numbers.
- Roster people sign in only with a Purview email, or an address the admin
  lists under Extra sign-in emails. Once a roster is loaded, self sign-up is
  closed. People missing from a later roster, or past their exit date, are
  switched off and their open claims go back to the pool.


#### Straight from Purview Shastra (automatic)

The Worker pulls the roster from Shastra's database every hour (`[triggers]` in `wrangler.toml`), and an admin can
press **Sync now** on the Roster page. It runs the same rules as loading the export file, applies the changes at once
and keeps a list of what changed (joined, changed, left). Date of joining (DOJ) is kept too. If Shastra sends an
empty or very short list (under half of the active people), nothing is changed and the Roster page says why.

Shastra answers through one read-only database function, `brahmastra_roster(p_key)`, which returns the roster
export's columns and nothing else, and only for the right key. Shastra stores only the key's hash.

| Name | Type | Value |
|---|---|---|
| `SHASTRA_FEED_KEY` | **secret** | the key made when the function was added in Shastra's Supabase |
| `SHASTRA_URL`, `SHASTRA_PUBLIC_KEY` | text (optional) | only if Shastra's Supabase project changes |

### Accounts and sign-in

- **Billers** are created by a team lead on the Team screen (first name, last
  name, work email, designation, role) and sign in with a **one-time code
  emailed to them every time** (Sign in with a code → Send me a code → enter
  the six digits). A team lead can optionally give them a temporary password
  too, or issue a sign-in code from the Team list when an email is slow.
- **Deleting accounts**: a team lead deletes a team member from the Team list
  (Delete). Anyone can delete their own account from the account menu (Delete
  my account, confirmed by typing the email). Claims on that person's desk go
  back to the pool; their notes stay in the claim history. The last active team
  lead cannot be deleted.
- **Team leads** create their own account from the sign-in screen (Create a
  team lead account: first name, last name, work email, designation from the
  list SME / TL / Sr TL / Assistant Manager / Manager / Sr Manager, and a
  password). A code sent to the email confirms it. They can then sign in with
  the password or with a code.
- Anyone signed in with a code can set or change a password from the menu
  without typing the old one.

Accounts are limited to email domains with "purview" in them (`*purview*` in
`ALLOWED_DOMAINS`; exact names and `*.suffix` patterns work too, and the
Worker's `ALLOWED_DOMAINS` variable can tighten it). Passwords are hashed in
the browser and hashed again on the server with a per-user salt and the
`PEPPER` secret. Codes are six digits, hashed on the server, valid for ten
minutes, five attempts, at most one per 45 seconds and ten per hour per
email. Sessions last 12 hours and extend while in use.

**Email delivery** (needed for codes in production). Set these on the Worker:

| Variable | Value |
|---|---|
| `EMAIL_PROVIDER` | `resend`, `brevo`, `sendgrid`, `graph` or `webhook` |
| `EMAIL_FROM` | `Brahmastra <no-reply@purview-healthcare.com>` (a sender the provider allows) |
| `EMAIL_API_KEY` | the provider's API key (secret); for `webhook`, a shared secret |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER` | for `graph` only: the app registration with the **Mail.Send** application permission (admin consent) and the mailbox to send from |
| `EMAIL_WEBHOOK_URL` | for `webhook` only: a URL that accepts `POST {secret, to, subject, text, html}`, for example a Google Apps Script web app like Gurukul's |

Without a provider, password sign-in still works and a team lead can hand out
codes from the Team screen. In demo mode no email is sent: the code is shown
on screen. The Team screen shows which provider is active and has a **Send a
test email** button.

#### Sending codes through Microsoft 365 (Graph), step by step

You need a Microsoft 365 admin (Global Administrator, or Application
Administrator for the registration plus Exchange Administrator for the
mailbox policy) and a mailbox the codes will come from.

**A. App registration.** Use a separate registration for the mailer so the
browser-facing Brahmastra registration never holds a secret.

1. Entra admin center (entra.microsoft.com) → Identity → Applications → App
   registrations → **New registration**. Name `Brahmastra Mailer`, single
   tenant, no redirect URI → Register.
2. On Overview, copy the **Application (client) ID** and the **Directory
   (tenant) ID**.
3. Certificates & secrets → Client secrets → **New client secret**
   (description `brahmastra-api`, expiry up to 24 months) → Add → copy the
   secret **Value** immediately; it is shown once. Put a reminder in the
   calendar for the expiry.
4. API permissions → Add a permission → Microsoft Graph → **Application
   permissions** → Mail → **Mail.Send** → Add permissions. Then **Grant admin
   consent for (your tenant)** → Yes. The Status column must show a green
   check. The default delegated `User.Read` can be removed.

**B. Sending mailbox.** Decide `MS_SENDER`, for example
`no-reply@purview-healthcare.com`. It must be a real Exchange Online mailbox:
a licensed user, or a shared mailbox (Microsoft 365 admin center → Teams &
groups → Shared mailboxes → Add; shared mailboxes need no licence).

**C. Limit the app to that mailbox (strongly recommended).** An application
`Mail.Send` permission can send as any mailbox in the tenant. Restrict it with
an Exchange application access policy (Exchange Online PowerShell; replace
the ids):

```powershell
Connect-ExchangeOnline
New-DistributionGroup -Name "Brahmastra Mailer" -Type Security -PrimarySmtpAddress brahmastra-mailer@purview-healthcare.com
Add-DistributionGroupMember -Identity "Brahmastra Mailer" -Member no-reply@purview-healthcare.com
New-ApplicationAccessPolicy -AppId <client id of Brahmastra Mailer> -PolicyScopeGroupId brahmastra-mailer@purview-healthcare.com -AccessRight RestrictAccess -Description "Brahmastra may send only as no-reply"
Test-ApplicationAccessPolicy -Identity no-reply@purview-healthcare.com -AppId <client id of Brahmastra Mailer>
```

The policy can take up to 30 minutes to apply.

**D. Worker variables** (Cloudflare → Workers & Pages → brahmastra-api →
Settings → Variables and secrets):

| Name | Type | Value |
|---|---|---|
| `EMAIL_PROVIDER` | text | `graph` |
| `EMAIL_FROM` | text | `Brahmastra <no-reply@purview-healthcare.com>` |
| `MS_TENANT_ID` | text | the Directory (tenant) ID |
| `MS_CLIENT_ID` | text | the Application (client) ID of *Brahmastra Mailer* |
| `MS_CLIENT_SECRET` | **secret** | the client secret value |
| `MS_SENDER` | text | `no-reply@purview-healthcare.com` (the address in `EMAIL_FROM`) |

Save, and deploy if the editor asks.

## Settings and themes

Everyone opens **Settings** from their name (top right): the theme (Light, Navy or Gold, the same as Purview
Shastra, or Match my computer), the text size, their password, signing out on every other device, their roster
profile (Emp ID, designation, department, who they report to, projects, shift, daily target) and the connected apps.
The theme is saved to the account (`users.prefs_json`), so it follows the person to any computer.

## Report files in OneDrive (Brahmastra Reports)

Every team lead's clients keep their files in one folder tree in the Purviewautomate OneDrive:

```
Brahmastra Reports / <Team lead> / <Client> /
   Production        Brahmastra, automatic: "Production - <Client> - Oct 2026.xlsx", one row per saved entry
   QA tracker        the QA file the lead keeps (input to Third Eye)
   Quality insights  Third Eye, automatic
   SLA & KPI         Drishti, automatic; and the AR Inventory report Brahmastra saves for Drishti
```

Brahmastra writes the Production file itself, a new one each month, for every client and location that has no
workbook link of its own (those keep using their link). The team lead is the roster TL whose projects are matched to
the client; a client with two TLs gets the file under each. It uses the same Microsoft 365 app as the sign-in emails,
which needs the **Files.ReadWrite.All application permission** (admin consent). Optional Worker variables:
`REPORTS_OWNER` (default `Purviewautomate@purview-healthcare.com`) and `REPORTS_AUTO=off` to stop it.

## Drishti and Sasha's Third Eye inside My day & reports

Team leads and above get a side menu in **My day & reports**, grouped by who the report is for:

| Group | Page | What it is |
|---|---|---|
| Internal | Team work | the day list and the team's notes (Brahmastra) |
| Internal | Quality & production | Sasha's Third Eye, Internal Reporting. **Load production** puts Brahmastra's entries and the roster straight in |
| For clients | Client reports | Third Eye's Client Reporting. **Fill from Brahmastra** puts today's AR inventory and the month's AR, submission and posting production in its boxes |
| For clients | SLA scorecard | Drishti, signed in. **Save AR Inventory to OneDrive** writes the AR Inventory report to the client's SLA & KPI folder for Drishti to pick |

Both apps run from their own addresses (`THIRD_EYE_URL`, `DRISHTI_URL` in the config block of `index.html`) with
`?embed=1&theme=…`, which hides their own header and takes Brahmastra's theme; their formulas, Google Sheet and
OneDrive files are unchanged. Every upload comes only from the Purviewautomate OneDrive: nothing is picked from the
computer or downloaded to be uploaded again. Third Eye has no sign-in. **How it works** on each page explains it.

**Drishti opens signed in** as the Brahmastra user once one Worker secret is set:

| Name | Type | Value |
|---|---|---|
| `DRISHTI_TOKEN_SECRET` | **secret** | the value of `TOKEN_SECRET` in Drishti's Apps Script → Project Settings → Script properties |
| `DRISHTI_API` | text (optional) | Drishti's Apps Script web app URL, only if it changes |

Brahmastra then signs people in to Drishti with Drishti's own 12-hour session token. Someone who has no Drishti
account yet gets one, created from their Brahmastra profile under the manager they report to (that manager must
be on Drishti's People tab). Brahmastra's admin opens Drishti as its Admin. Never put the secret in the repository.

**E. Test.** Sign in as a team lead → Team → **Send a test email**. When it
arrives, sign out and try **Sign in with a code**.

#### Billers' work in OneDrive

A team lead can link an Excel workbook (.xlsx in the Purview Automate
OneDrive) to a client, and a different one to any of its locations (Clients
screen → "link an Excel workbook", or the 📎 next to a location). From then
on every entry a biller saves on those claims is appended as one row (saved
at, biller, client, location, claim #, account #, patient, payer, DOS, CPT,
provider, balance, SAAG status / sub-status / action, bucket, effective
matrix, follow-up, claim state, the one-cell note). The first row of an
empty sheet becomes the header. The copy is made by the Worker, so billers
need no OneDrive access.

It uses the same *Brahmastra Mailer* registration as the sign-in emails,
which therefore needs one more permission: Entra admin center → App
registrations → Brahmastra Mailer → API permissions → Add a permission →
Microsoft Graph → **Application permissions** → Files → **Files.ReadWrite.All**
→ Add, then **Grant admin consent**. The Clients screen shows, next to each
link, when the last row was copied or why the last copy failed.

**If it fails**, the toast quotes the provider's answer:

- `Microsoft sign-in (token) did not accept (401)`: tenant id, client id or
  secret is wrong, or the secret expired.
- `Microsoft Graph did not accept the email (403 … ErrorAccessDenied)`:
  `Mail.Send` has no admin consent yet, or the access policy does not include
  `MS_SENDER`.
- `(404 … MailboxNotEnabledForRESTAPI / ResourceNotFound)`: `MS_SENDER` is
  not an Exchange Online mailbox.
- Codes land in Junk: keep the sender in your own Microsoft 365 domain (SPF
  and DKIM are then already in place) and ask IT to allow-list it.

### Locations: who works what

**Locations** lists every client and location with the billers mapped to it
and an "allocate on upload" switch. A location with no billers of its own
uses the client-level billers. "Allocate open claims now" hands every open
claim of that place to its billers at once.

### Inventory uploads

Files open straight from OneDrive: **Upload inventory → Open OneDrive** signs
you in with your Purview Microsoft account (pop-up) and opens the pinned
Purview Automate inventory folder; pick the file and it is read from OneDrive
(nothing is written back). A team lead pins that folder once with "Pin the
Purview Automate folder" at the top of the Inventory screen (paste the
folder's sharing link); you can also paste a link to any folder or file inside
the picker, or drop a file from the computer. **Upload history** links each
batch back to its OneDrive file.

Microsoft sign-in works only when the app is opened from the address
registered on the Brahmastra app registration in Entra ID
(`MS_REDIRECT_URI` in `index.html`, currently the GitHub Pages site). If you
host the app elsewhere, add that address as a single-page application redirect
URI on the registration and update `MS_REDIRECT_URI`.

One screen: pick the client (and location), choose the file from the Purview
Automate OneDrive or from the computer, done. When the file's columns are
recognised the claims load at once; only a file with unfamiliar column names
stops at a column check. As soon as the claims load they are handed to the
billers mapped to that location (evenly, highest priority first, patients and
payers kept together) unless you untick "Allocate after loading"; a team lead
can move them afterwards on Allocate or Claims.

- **Fresh inventory**: claims never worked. New claims are added; claims already
  on file are refreshed (balance, status, payer...). Rows whose status reads
  paid/closed, or whose balance is zero, close the claim; credit balances and
  unbilled rows are excluded from work.
- **Previously worked inventory**: claims the team or the client already
  touched. Map the **Date worked** and **Comments** columns; each claim gets a
  follow-up date (date worked + the client's follow-up days, or the file's own
  follow-up column) and comes back into the pool when it is due.

Excel (`.xlsx`, `.xls`) and CSV are accepted. Columns are matched by name
(`IG Claim ID#/Charge ID#`, `Claim ID`, `Patient Name`, `Payer`, `DOS`, `CPT`,
`Provider`, `Balance Amount($)`, `Status`, `Sub Status`, `Action`,
`Comments/Notes`, `Date Worked`, and the usual variants); when a claim column
cannot be found the column check lets you point at the right ones. A claim is recognised across uploads by its claim number, or,
without one, by patient + date of service + payer + provider. Several service
lines of one claim are rolled up into one claim with the lines kept
underneath. A file that has a Location column can be split across the client's
locations automatically.

**Upload history** lists every batch; an upload can be undone while none of
the claims it added have been worked.

### Prioritisation (the Revenue Doctor's rules)

Every claim gets a priority score when it is loaded and again when it is
allocated, so ageing is always current.

| Signal | Points |
|---|---|
| Status read from the file: Rejected 100 · Denied 90 · Partially paid 75 · Awaiting secondary 65 · Awaiting payer 50 · Other / unknown 40 · Patient responsibility 20 | up to 100 |
| Age since date of service: 75–90 days (near the 90-day timely filing limit) 45 · 91–120 (past the window, appeal soon) 35 · 121–360 (aged, appeal-eligible) 30 · 361+ (confirm the appeal filing limit first) 25 · 61–74 20 · 31–60 10 | up to 45 |
| Value tier: High (above the inventory's average balance) 30 · Medium ($100 up to the average) 15 · Low (under $100) 0 | up to 30 |
| Balance: 6 × log10(balance) | up to 25 |
| Previously worked: follow-up due 15, overdue by 15+ days 25 | up to 25 |
| Escalated +10 · each skip −5 · Low tier halves the total | |

The "why this order" text on every claim spells the reasons out, and the
biller's day list is sorted by it.

### Allocation

Pick a client (and optionally a location). The pool is every unassigned claim
plus every worked claim whose follow-up date has arrived. Filter it (fresh or
worked, tiers, status, payers, minimum balance), pick the people and how many
claims each takes today (default 35, the Revenue Doctor's planning figure),
choose a strategy, preview, assign.

- **Smart batching**: every claim of a patient stays with one person, the rest
  are grouped by payer, all in priority order.
- **Payer batching**: fewest payers per person for the most money.
- **Patient batching**: one touch resolves several claims.
- **Straight priority, round robin** and **Balance the dollars**.

Claims already on a desk are not touched; "Return unworked to pool" or the
bulk actions on the Claims screen move them.

### The biller's day

**My day** lists everything on the biller's desk plus what they worked today,
in priority order, with filters for claim #, patient, account, payer,
provider, CPT, amount, SAAG status, bucket and state. Rows are coloured:

- **green**: the SAAG entry closed the claim (bucket Closed, or Effective Matrix
  Processing-Closed / Payment-Cash In Bank);
- **yellow**: worked today with any other status;
- **white**: not worked yet.

**Work the next claim** opens the highest-priority claim; clicking any row opens
that claim instead. Only one claim is open per biller at a time.

### The claim profile

Everything about the claim in one place: the file facts, service lines, the
priority reasons, the patient's other open claims (an entry can be applied to
them too), **Suggested next steps** from the Gurukul denial library (matched to
the SAAG sub-status or the file's wording, searchable), and the **history** of
every entry.

A work entry has two parts:

1. **SAAG**: Status › Sub-status › Action from the matrix (only valid
   combinations are offered). The Effective Matrix value comes from the
   workbook and sets the **bucket** (Payer, Client, Closed or Purview), which
   the biller can change.
2. **Note**, in the team's fixed format, each field its own box: DOS
   (MM/DD/YYYY), CLM#, DENIAL, SOURCE and REF (a call needs its reference),
   PRE CALL CHECK (what was verified before acting), RCA / FINDINGS, and
   ACTION from the fixed list (corrected & resubmitted, appeal filed, pending
   with client, pending with patient, pending with payer, follow up, closed).

The note is stored as **one cell**, for example:

```
DOS: 08/09/2026 | CLM#: 7711130 | DENIAL: TFL - Timely filing | SOURCE: Call, REF: 88120345 | PRE CALL CHECK: Eligibility active on DOS; Claim status with payer | RCA/FINDINGS: ... | ACTION: pending with client | SAAG: Claim Denied > TFL Exceeded/No POTFL > Need to Appeal | BUCKET: Client | EFFECTIVE: Pending-Client Assistance | FOLLOW-UP: 11/10/2026
```

A closing entry closes the claim. Any other entry sets a follow-up date (14
days for Client Assistance, 7 for Purview internal review, 30 for the
collectible buckets, or the client's default) and the claim comes back into the
allocation pool when the date arrives.

Entries can be **edited for 24 hours** by their author or a team lead; after
that they are read-only (the server enforces it).

### SAAG reference and updates

**SAAG** shows the matrix: pick a status, a sub-status, and see the actions
with their Effective Matrix and bucket. When the workbook changes, run

```
powershell -ExecutionPolicy Bypass -File dev\build-saag.ps1 -Workbook "C:\path\SAAG_Claim_Entry_Tool.xlsx"
```

and commit the new `lib/saag.js`. The whole team gets it on the next refresh.
The bucket mapping lives in `EFFECTIVE_BUCKET` in `index.html`.

### Reports

**Reports** lists every entry with its claim (worked claims, skips, plain
notes) for a date range, client, location or biller, with a CSV download that
has the SAAG fields, every note field and the one-cell note. **Team** shows
claims worked per person per day. **Claims** exports the filtered claim list,
including the last SAAG entry per claim.

## Limits and notes

- Demo mode is for trying the app; it is one browser, one tab, no sharing.
- The Worker has no rate limiting on sign-in; keep the allowed domains and
  strong passwords. Put the Worker behind Cloudflare Access if you want SSO.
- Uploads go to the server in chunks of 250 claims; very large files just take
  a little longer.
- Timely filing is modelled with the common 90-day window; the appeal filing
  limit prompt starts at 360 days. Both live in `index.html` (`urgencyOf`).
- Not carried over from the previous Brahmastra: the departmental TAT boards,
  OneDrive / Microsoft sign-in, and the feedback widget.

## Development on this PC

No Node, no build. `dev/serve.ps1` serves the folder on
http://localhost:8787 and `.claude/launch.json` lets Claude Code start it.
Edit `index.html` and refresh. The Worker runs in the page in demo mode, so
changes to `worker.js` are tested the same way; the production Worker is the
same file.
