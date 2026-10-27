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
| `dev/build-saag.ps1` | Regenerates `lib/saag.js` from a new copy of the workbook. |
| `dev/build-denial-library.ps1` | Refreshes `lib/denial-library.js` from Gurukul's `index.html`. |
| `dev/serve.ps1` | A tiny local web server (PowerShell, no Node needed) for trying the app on a PC. |
| `wrangler.toml` | Optional, for deploying the Worker with Wrangler instead of the dashboard. |

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

### 1. Create the API (Cloudflare dashboard, about ten minutes)

1. **Workers & Pages → D1 → Create database**, name it `brahmastra`.
2. **Workers & Pages → Create → Worker**, name it `brahmastra-api`. Open the
   editor, delete the starter code, paste the whole of `worker.js`, Deploy.
3. **Worker → Settings → Bindings → Add → D1 database**. Variable name `DB`,
   database `brahmastra`. Save.
4. **Worker → Settings → Variables and secrets**. Add:
   - `PEPPER` (secret): any long random text. Adds to every password hash.
   - `BOOTSTRAP_EMAIL` (text): the first team lead's email.
   - `BOOTSTRAP_PASSWORD` (secret): their first password.
   - `ALLOWED_DOMAINS` (text): `purview-healthcare.com,purviewservices.com`.
   Without `BOOTSTRAP_*` the first team lead is
   `supervisor@purview-healthcare.com` / `brahmastra-setup` and must change the
   password at first sign-in.
5. Open `https://brahmastra-api.<your-account>.workers.dev/health`. You should
   see `{"ok":true,...}`. The tables are created on this first request, and
   later versions add any new columns on their own.

With Wrangler: fill in the `database_id` in `wrangler.toml`, set the secrets,
run `wrangler deploy`.

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

Accounts are email + password. Passwords are hashed in the browser and hashed
again on the server with a per-user salt and the `PEPPER` secret. Sessions last
12 hours and extend while in use. Team leads can only create accounts on the
allowed email domains.

### Inventory uploads

Pick a client, a location, and the kind of inventory:

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
`Comments/Notes`, `Date Worked`, and the usual variants) and can be corrected
before loading. A claim is recognised across uploads by its claim number, or,
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
