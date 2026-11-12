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
| `index.html` | The page: settings, styles, and the script tags. Host it anywhere static: GitHub Pages, Cloudflare Pages. |
| `app/app.jsx` | The app's code (React with JSX). **Edit this**, then run `node tools/build.mjs`. |
| `app/app.js` | Built from `app/app.jsx` by `tools/build.mjs`; what browsers load, so they no longer compile the app on every visit. Never edit it by hand. |
| `tools/` | The build and the checks (`npm run check` there): build up to date, lint, the API checks in `tools/tests`, and a browser pass over every page for every role in `tools/browser`. They run on GitHub for every push (`.github/workflows/checks.yml`). |
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

- **Team lead**: Live status, Dashboard, Inventory, Allocate, Claims, Team, Clients, SAAG,
  Reports, and a day list of their own.
- **Biller**: My day (the allocations, one claim at a time) and My work (their
  history).
- **Admin** (`ADMIN_EMAILS` in `wrangler.toml`, signs in with an email code):
  everything a team lead has, plus the **Roster** screen.

### Roster (Purview Shastra)

The roster comes only from Purview Shastra (below); there is no file upload. People are
matched by Emp ID (then email, then name) and their department, projects, manager, status
and date of joining are kept. People are changed in Shastra, not in Brahmastra.

- Agents become billers; SMEs, Team Leads and Sr Team Leads become team leads
  for their own projects; Assistant Managers, Managers and Sr Managers become
  team leads for their projects and every project of the people below them;
  the Vice President sees every project. CEO, Director, HR, IT, Administration,
  QA, MIS and Tech Support get no access, and nor does anyone only on Eligibility
  Verification, PCC, Credentialing or Reporting (not worked in Brahmastra; they are
  switched off).
- The top bar stays one row: **RACI** first, then SLA (Drishti and the scorecard, one
  click away all day), Sasha's Third Eye, Live status, Dashboard and Claims sit
  in front, the rest is grouped under **Work** (Needs attention, Posting & submission,
  Inventory & allocation, Escalation tracker) and **Manage** (Team, Note templates, Clients &
  locations, SAAG reference, TFL / AFL, Roster for admins, Audit trail for admins and the VP). Client 360 is not on
  the menu: it opens from **Dashboard › Client 360 report › Open Client 360**, a client's name or link, or Ctrl+K. The escalation count shows on the
  Live status tab, and the attention and hand-off counts on the group button while it is closed.
- The view follows the Shastra department and "also in" departments: anyone on AR
  gets the AR screens; Posting and / or Submission people (team leads too) get
  only their desk: dashboard, hand-offs, the claims sent to them, no SAAG,
  inventory or allocation.

#### Client 360

**Dashboard › Client 360 report › Open Client 360** (or **Open Client 360** on a client card, a client's name on the RACI page, or Ctrl+K) shows one
client on one page, for team leads, managers and the VP (and anyone a client is shared with, read-only):

- a health line (**On track / Needs attention / At risk**) with the plain reasons: over-90 above the 15% target, SLA
  below 90%, claims past or near timely filing, escalations over 24 hours, old requests waiting on the client,
  many missed tasks;
- AR balance (against a month ago), over 90 days (a share of the money owed, its dollars the same money: credit balances
  are left out, as on the Dashboard), the SLA score ticked at month-end, collected (from payment posting
  hand-offs, against the period before), dollars waiting on the client, dollars at timely-filing risk;
- AR and the over-90 share of the money owed by month (Brahmastra keeps one reading a day, so the trend fills in by itself);
- denial and rejection reasons from billers' entries, in dollars;
- every request waiting on the client, how long, whether it was sent, and the client's average reply time;
- escalations, missed tasks, entries made, RACI;
- the **month-end checklist** (inventory uploaded, internal reports reviewed, AR Inventory sent to the SLA
  scorecard, client pack built, SLA scored with its score, pack sent), each with a due working day of the next
  month; inventory and the scorecard step tick by themselves;
- the **client call log**: calls, emails, meetings, notes and the next call with what to prepare.

**Client call pack (PDF)** prints the page or saves it as a PDF for the meeting. Changes to the log and the
month-end checklist are kept in the audit trail.

#### Dashboard › Client 360 report (present it, edit it, send the PDF)

The client report is Brahmastra's own, built from Brahmastra's data: nothing is exported or uploaded. It follows
Sasha's Third Eye's client report (its `client.html`) page for page and rule for rule; Third Eye itself is not
changed and keeps working on its own address. Team leads and above, for their own clients.

**It starts with the data and the dates.** Opening the tab shows the start screen:
1. **Data.** EV production is the one thing to upload, because Brahmastra does not do eligibility checks: *Upload EV
   from OneDrive* reads the file in the browser, finds its columns by their usual names (date of the check, DOS,
   insurance, status or verification type, action, done by, account, comment) and shows what it found before
   *Save to the report*. The patient's name, birth date, member ID, phone and address are never read. The rows are
   kept for the client (and location), so the whole team sees the same EV page; a new file for the same dates
   replaces the old rows, and *Remove* takes a file out. Below, everything Brahmastra fills by itself is listed with
   the figure each page will show (or "nothing in these dates; the page is left out").
2. **Dates.** Monthly, Weekly or Custom, whether to compare with the period before, and the location.

**Create dashboard** opens the report. *Made before* reopens a period the team already made in one click, and
*Change data or dates* on the dashboard goes back to the start.

**Pages** (1280 x 720, like slides), in this order everywhere (the pages list, Present and the PDF): Cover (with the
client's logo), Executive summary, EV, Submission, Rejections, Payment posting, Inventory analysis, Inventory
breakdown, AR production, Denials, Top denials: RCA and Client assistance. A page with nothing in the period shows
greyed out in the list and stays out of the PDF and Present (the period before alone, which the comparison reads,
does not count).

**Where the figures come from**

| Page | From |
|---|---|
| Inventory | the claims open in AR at the end of the period against the end of the period before (aging from the date of service: 0-30 ... 181-360 and 360 plus, Future DOS for a date of service typed in the future, and Unknown age for a claim with no date of service or age), and where the claims open at the period before went: AR close (closed by AR), AR close · sent to Posting, Posting close (posted and closed), Pending Submission, Submission close · AR follow-up (a submitted claim comes back to AR for its follow-up), Excluded |
| AR production, Denials, RCA | billers' work entries in the period (SAAG status, sub-status, action and bucket); a claim with no entry is *Not worked yet*; a claim worked twice counts once, at its latest entry, in the KPIs and the charts |
| Submission, Rejections, Payment posting | the Submission, Rejections and Payment posting desks (posted amounts and check details from the posting proof) |
| Client assistance | requests sent to the client, with their reason and whether they were answered |
| EV | the EV production file uploaded on the start screen (verifications, insurance wise, verification type or status) |
| Executive summary | the headline of each page and the six-month AR and collections trend |

**Inventory at a past date.** Brahmastra keeps a snapshot of every client's open inventory (every hour and after
each upload; month ends and Sundays are kept, other days for 45 days). Today's inventory is live.
For a date before the snapshots started, the inventory is rebuilt from the claims' history (claims loaded by then
that had not yet been closed, excluded or sent to a desk) and the page says so.

**Money owed, as on the Dashboard.** Over 90 days, older than 120 or 360 days and every share of money on the
inventory pages (age groups, payers, status, actions) are of the money owed: credit balances are left out (the page
says how much), a Future DOS claim is owed but never old, and a claim with no age is never counted as old.

**Third Eye's rules, kept as they are:** periods by month, week (Monday to Sunday) or custom dates, each compared
with the period of the same length before it; working days Monday to Friday; payer names merged across spellings;
the Pareto rule (the reasons that make 80% are highlighted, the long tail folds into *Other*); the movers insights
(a change counts at 3 claims or $500 and 5% of the total); the top denial set for the RCA (the 80% set when it has
3 to 6 reasons, else the top 3 or 5); closed, rejected, denied and paid read the same way as Third Eye reads them.

**Interactive, like Power BI.** Hover any bar for its figures; click a bar, a slice or a row to filter the page
(Shift+click adds to the filter), or use the filter buttons; **Same filters on every page** keeps them when you
change page. Each chart switches between claims (#) and dollars ($) and can show its table. **Claims behind this
view**, under the page, lists them with search and CSV; click one to open the claim.

**Editing (team leads and up).** Click any title or insight line to change it, remove a line or add your own; fill
the RCA and the plan per denial reason, the asks of the client and the focus for next period. Edits are kept in
Brahmastra for that client, period and location, so the whole team sees the same report, and each save is in the
audit trail. Untick a page under **In PDF** to leave it out of the PDF and Present. **View as client** hides the editing.
**Add the client's logo** takes a PNG, JPG or WebP from the Purviewautomate OneDrive (shrunk to a small image).

**Present** shows the ticked pages full screen (arrow keys move, C clears the filters, Esc leaves).
**Download PDF** gives one file with one widescreen page per ticked page, in the order above, always the full picture (no filters); **PDF of this view**
appears when filters are set and prints the pages with them. The PDF is saved from the browser's print dialog
(Save as PDF), named after the client and the period.

#### Live status: what everyone is on now (team leads and up)

**Live status** is the floor right now, refreshed every 30 seconds while the tab is open. Filters: client (and
location) and **team lead** (assistant managers, managers and the VP; a team lead sees their own team). On top,
**Needs you** lists escalations, client requests to send and missed tasks; then in today, working now, idle now,
worked today against the target, closed today and **left over** (allocated before this shift and not worked) split
into **high priority** (the High tier) and other.

- **On the floor now**: each biller with their **Shastra** status (below), their status in Brahmastra (working, **idle**
  after 30 minutes without an entry in their shift, not started, out today), the claim they have open with its client, payer and balance and how long they have
  been on it (the claim number opens the claim), pace this shift against their target, on desk, closed today and left
  over. Managers and above see the billers grouped by team lead: each group opens and closes (a closed group shows
  working, idle and on desks), **Expand all** / **Collapse all**, or **One list**. Click a biller's name to open
  **their claims**.
- Below the floor: unassigned claims, claims with Posting / Submission and follow-ups due today.
- Posting and Submission people are not on the floor: they have their own desks.
- **Shastra**: each person's attendance in Purview Shastra now, read every 2 minutes with Shastra's own rules
  (the day rolls at 05:00 IST, late is 10 minutes past the shift start, Saturday and Sunday are the week off unless
  Shastra says otherwise): **Present** or **Late** with the time in, **On break**, **Logged out**, **Not in yet**,
  **On leave** (or week off, holiday) and **Not logged in** in red once someone has no punch in an hour after their
  shift began. Needs `dev/shastra-live-feed.sql` run once in Shastra's Supabase (the same key as the roster feed).
- **Not logged in** alert: the person's team lead (and the team leads of their clients) get a pop-up on whatever page
  they have open, a red line on Live status, an entry in the bell and, once they allow it, a notification on their
  computer while Brahmastra is open. Managers, the VP and admins see the bell. The pop-up shows the claims on their
  desk not started (and how many are high priority) and exactly how they would be shared, with **Reallocate equally**,
  **Mark out only**, **Remind me in 30 min** and **They told me · dismiss** (for everyone, for the day).
- **Reallocate equally** shares the untouched claims (assigned, not started) of each client between the people on
  that client's team who are logged in to Shastra and not marked out: the same number each (the extra one to the
  lightest desk), highest priority first. Claims they already started stay with them. They are marked Out today
  (*In after all* gives the day back). **Rebalance**, for someone marked **Out today**, follows the same equal rule.
  Each move is in the audit trail and on the claim's history.
- **New claims notice**: whenever claims are given to a biller (Allocate, reassigning, Rebalance, Reallocate), they
  see "N new claims were allocated to you" at the top of their screen with who gave them and why, in the bell and,
  once they allow it, on their computer. *Open my list* or *OK* closes it.
- **Out today** marks someone absent with a reason (**Half day** counts 4 hours of floor time on Team status).
- The **coaching card** (entries a day over 30 days against target, skips, carried over, escalations, hand-offs sent
  back, average note length, days out, the statuses they enter most, and **1:1 notes** that team leads and up see and
  the biller never does) opens from **Search** (Ctrl+K) on a biller's name. QA scores stay in Sasha's Third Eye.
- **Manage › Note templates**: text for RCA / findings, for every client or one, written by team leads and up.
  Billers pick one from **Insert a template** above the RCA box.
- On **Work this claim**, a biller sees the three SAAG combinations the team used most in the last 90 days for
  that payer (or the client when the payer is new); one click fills status, sub-status, action and bucket.

#### Dashboard: Team status, Inventory status, Client 360 report

**Dashboard** has three parts: **Team status**, **Inventory status** (every client's account at a glance, below)
and **Client 360 report** (pick the client, then its report pack: the *Dashboard › Client 360 report* section
above). Team status and Inventory status share the filters client, **team lead** (managers and up) and the dates:
**Today, This week, This month, Custom**.

**Team status** is Sasha's Third Eye's Team Status, built from Brahmastra's own entries and the Purview Shastra
roster, grouped by team lead (no Emp ID):

- **Status** and date of joining from Purview Shastra: Production, Training, OJT, Serving notice, Sabbatical.
- **Ramp-up**: Training and OJT are due in production 6 weeks from their start (the start date kept on Team status,
  otherwise the date of joining), or on the date the lead agreed. People past it show in a red banner.
- **Attainment**: entries against the target (the daily target for each working day in the dates; a half day counts
  half, other days out count nothing; Purview Shastra's attendance decides half days, leave, week offs and a Saturday
  worked, and Brahmastra's Out today marks fill in the days Shastra has no record of). It counts the days already finished (up to yesterday), so a day still under
  way does not count against anyone; with only today picked, it is today's. Production people under 90% are
  **below the mark**; Training and OJT are **in ramp-up** and not judged against it. Claims worked and **team task
  items** done (Needs attention › Team tasks, below) both count toward it: the line under it says how many of each.
- **Tasks**: the team task items each person marked done in the dates (by the day of the update, the night shift's early
  hours counting to the day before, as for claims), with how many tasks they worked and completed. The CSV has
  **Task items** and **Tasks completed**, and its count for the attainment is claims plus task items.
- **Floor time needed**: 8 hours a working day, 4 for a half day. **On floor** comes from Purview Shastra (finished
  shifts with breaks taken out; a shift still open counts up to now) and shows **met** or **short** on the finished
  days. **Idle** is what Shastra Guard saw while the person was punched in, breaks left out: no movement plus screen
  locked (the split is in the tooltip and the CSV). **Breaks** is the break time Shastra recorded on the days with
  floor time, with the average a day and the days over the hour Shastra allows (the KPI and the CSV carry it
  too). People with no attendance in Shastra for the dates, or no Guard
  machine linked, are listed under roster checks. Until the feed is set up (below) they show –.
- **Left over** now, with how many are high priority, and a **note** per person: start, due in production (or plan
  end) and a comment, seen by every lead who sees that person and kept in the audit trail.
- **Suggestions** in plain pointers, from the same figures: **Do today** (past the ramp-up date; 3 or more high
  priority claims left over, or rebalance them when the person is out today; attainment under 60% on the finished
  days; on the floor under 75% of the time needed), **This week** (attainment 60 to 89%; due in production within 7
  days; floor time short; idle 1 hour or more and at least 10% of their floor time; absent, sick or marked out 2 days
  or more; 1 or 2 high priority left over) and **Keep going** (100% or more with nothing flagged, and a teammate they could help). Each
  says what we see and what to do. **Copy for my 1:1s** copies them.
- At the bottom, **performance by status** and **roster checks** (no date of joining, no team lead, names that
  appear twice; fixed in Purview Shastra). **CSV for supervisors** downloads the table.

Click **allocations** under a person's name for what was allocated to them and what they worked in the dates
(the list My day & reports used to have), filtered to that person, with its CSV.

#### Dashboard › Inventory status

For team leads and above (a team lead sees their own clients, a manager their span), **Inventory status** lists
every client worst first: health with its reasons, team lead and manager, AR against a month
ago, unassigned, over 90, collected for the dates, the **SLA score** from Drishti (the score, its band and the change
since the period before, with a dot per scope: AR, Submission, Payment Posting, EV, SLA tasks), **pulling it down**
(the red and amber KPIs by name), missed tasks, dollars waiting on the client, timely-filing risk, **days to clear**
(claims still to work divided by the team's entries a working day over the last two weeks; a client nobody worked
shows that instead of a made-up number) and when its inventory was last uploaded. On top: Workable AR, unassigned,
over 90, collected, **KPIs in the red** across the clients and the **SLA score, average** with the green, amber and
red count. Click a client for its Client 360, **scorecard ›** for its scorecard. Below, the **claims in detail**
(by client and location, value tier, age, status, buckets after work, SAAG statuses, payers, time on calls; click a
bar to narrow the charts), then:

- **Managers side by side** (the VP, admins and managers): clients, people under them, entries and skips by their
  people, missed tasks, escalations over 24 hours and SLA average, for the dates. The VP sees every manager, a
  manager their own line.
- **Data freshness**: inventory older than a week, an SLA not scored after its due day, a failed or late roster
  sync.
- **Audit trail** (admins and the VP): who shared a client or took it back, changed the RACI, who gets feedback, a
  client, a responsibility, settings, a team member's role, projects or access, Team status notes and month-end,
  with when and what.

#### SLA

The SLA tab reads as one embedded app, like Sasha's Third Eye: Drishti opens inside it, signed in as you, in
Brahmastra's theme (Light, Navy or Gold, flat cards and all), with Drishti's own tabs (Overview, Clients,
Formulas, Guide, Q&A and Feedback) in Brahmastra's tab row and two tabs of Brahmastra's own beside them, **SLA
scorecard** and **Monday digest**. Drishti's pages are where the period's reports are uploaded or a value is typed;
the scorecard reads them a few minutes later. **Save AR Inventory to OneDrive** above the page writes today's AR
Inventory report to the client's SLA & KPI folder for Drishti to pick.

**SLA scorecard** is Drishti's scorecard for one client and period in Client 360's style, read by Brahmastra
(nothing in Drishti changes): the score dial with its band (green 90 and above, amber 80 to 89, red under 80), how
many KPIs are green, amber and red, the change from the period before, the month-end **SLA scored** step ticked by
itself from the score; a card per scope (AR, Submission, Payment Posting, EV, SLA tasks) with its share on target;
**what pulls it down** and **strengths**, each KPI with its value, standard and the comment; the **score by month**;
**where the figures come from** (the report each KPI is read from, the files uploaded for the period); and **every
KPI** with its value, standard, **formula** (Drishti's own wording, the same as its Formulas page), status, source
and comment, with a CSV. Periods: Latest, Monthly or Weekly, with ‹ › between the periods Drishti has. The scoring is
Drishti's clientScorecard copied line for line (the same thresholds, a client's own overrides, the locked Net
Collection Rate formula). Brahmastra matches its clients to Drishti's by name; a client not found says so and
lists Drishti's clients. Needs `DRISHTI_TOKEN_SECRET` (below); Drishti is asked once every ten minutes.

**Upload this period's reports** on the scorecard goes back to Drishti's own page. **Monday digest** is the
digest email's page (below).

The old `#/portfolio`, `#/teamtoday` and `#/dashboard` links still work: they open Inventory status, Live status
and Team status.

#### Client profile: scope of work, responsibility, change history

Every client has a profile: the **scope of work** Purview does (AR follow-up, Payment posting, Submission,
Rejections), its **locations**, a daily **target** for each part of the scope, the **production file** (Brahmastra
keeps it, or the client's own workbook), and the **responsible person** for each part, with an optional backup
(Submission also names who rechecks a submitted claim, and when: 48 working hours after submitting unless the client
needs it sooner; a supervisor sets 1 to 48 under Target and TAT, and anything above 48 is saved as 48).

- **A new client needs all of it.** Manage › Clients & locations › Add client opens the setup; it cannot be
  created until each part is filled in. Older clients show **Profile incomplete** with what is missing (and
  when a responsible person has left), the team lead's bell says so, and **Edit profile** completes it.
- **A part of the scope always has a responsible person.** On the client card a part that is in the scope of
  work can only be given to a person (the 48-hour recheck may also be the biller who sent it); to stop a part,
  take it out of the scope on the profile.
- **Responsible means access.** Whoever is set on a client as AR, posting, submission, follow-up or rejections
  person, or is on the client's team, gets that client straight away: its profile in **My clients** and its
  claims. Supervisors set there can change the profile; billers only see it. Posting and submission people get a
  **Claims** page with every claim of the clients they are responsible for (their work still happens in their
  desk tab).
- **They are told.** Whoever is made responsible (or put on the team) gets a line in their bell ("Sweety made you
  the Submission person for Dr Vontela...") for two weeks and an email; someone taken off is told too.
- **Change history.** Every change to a client (profile, responsible people with what they were before, teams,
  locations, shares, RACI, month-end) is kept with who and when; **Change history** on the client card shows it
  to the supervisors on the client (not billers; billers have no RACI either).
- SAAG: **Claim Not On File › Policy Active** is added in the app (with the same actions as the other Claim Not
  On File sub-statuses) until the SAAG workbook carries it; add it to the workbook too.

#### Search, the bell, phones, signing out

- **Search** (top right, or **Ctrl+K** / **Cmd+K** anywhere): type part of a page name, a client (opens its
  Client 360), a biller (opens their coaching card), or a claim number, account number or patient name. Arrow keys
  and Enter, Esc to close. Team leads find claims on the clients they lead; billers find only claims on their list
  or that they worked.
- **The bell** lists what needs you now, each line opening the page that deals with it. Team leads: escalations
  (red after 24 hours), client requests to send, missed tasks, claims on the desks of people out today, month-end
  steps past due, hand-offs on their desk. Billers: their list for today, escalations their team lead answered
  and hand-offs sent back to them in the last 3 days. Feedback readers: new feedback. It refreshes every 2 minutes
  and on every page change; the number counts what is new since you last opened it.
- **Phones**: every page fits a phone screen; the menu sits under the logo and wide tables scroll sideways.
- **Signing out when idle**: after 24 hours without a key, click, scroll or touch in any Brahmastra tab (working
  inside the embedded Sasha's Third Eye or SLA page counts), a 1-minute warning shows, then the person is signed
  out to keep patient data safe. Time spent in another program or browser tab (a payer portal,
  a phone call) does not count as activity in Brahmastra.

#### Monday digest email

Every Monday from about 8:30 AM IST the server sends **one email per manager's span**: Sweety's clients, Sandesh's
clients and Joseph's clients (the managers on the roster and the clients their projects map to, as in Dashboard ›
Portfolio › Managers side by side). Each goes to **every supervisor on those clients**: the manager, the clients' team leads and
SMEs, posting / submission leads, the VP and admins (view-only shares are left out). So a team lead gets their
manager's span, a manager their own, and the VP all three. Active clients that are in no manager's span go in one
more email, "Clients without a manager", to the VP and admins.

It opens with a header (**Manager name**, **Designation**, **Period**: the week, and the clients) and an **SLA report
card**: each client's last finished month in Drishti, worst at the bottom, with the average score and how many are
green, amber and red; per client the score and band, KPIs and SLAs on target, the change against the month before,
its **team leads and SMEs**, a dot per scope and what pulls it down (value against standard; five lines for a red
client, three otherwise), and a button to the SLA scorecards. Clients Drishti has no month for are named below it.

It covers last week (Monday to Sunday): how many clients are at risk, on watch and on track; span totals for AR
(against a week before), over 90 (against the 15% target), collected and entries; what needs attention, client by
client (the Client 360 health rules, month-end steps past due, missed tasks) with one piece of good news; a row
per client (health, AR and its change, over 90, collected, entries, SLA, month-end, escalations over 24 hours,
requests waiting on the client); who worked how much; and the denials worked. Clients, staff and figures only:
no patient names, claim or account numbers.

- **SLA › Monday digest** lists every span the person is on (the VP and admins all of them) with its clients and
  who gets it, when it last went, any that did not arrive and why, **Preview this week's** and **Email me a copy**
  (a team lead's preview and copy hold only their own clients, the same as their Monday email).
  Admins and the VP also get **Send this week's now** (only to people who have not had it this week; noted in the
  audit trail).
- **Settings › Email**: anyone can turn their digest off (or on again).
- How it is sent: the same Microsoft 365 mailbox as the sign-in codes and feedback (`EMAIL_PROVIDER`). A second
  schedule in `wrangler.toml` (`*/10 3-7 * * 1`, every 10 minutes from 08:30 to 13:20 IST on Mondays) sends a few
  spans per run (`DIGEST_BATCH`, default 3) until every span has gone, and never sends a span to the same person
  twice in a week. `APP_URL` puts an **Open Client 360** button in the email.

#### Feedback

Every page has a **Feedback** tab on the right edge. Anyone signed in (billers too) picks what it is
(something is wrong, an idea, this helped me), writes a few words, and adds up to 4 pictures or PDFs:
**Capture this screen** (the page as it is, the Sasha's Third Eye or SLA page in it included), a snippet
pasted with Ctrl+V (Win+Shift+S first), or files attached or dropped in. Big pictures are made smaller.
It is emailed, with the files attached, to **Shreya and Sweety** (the active people with those first names,
team leads and up first, at the email on their Brahmastra account), and kept in their **Feedback inbox**
(Manage › Feedback inbox, with a count of new ones), where they open the files and mark each one done.
If an email does not go out, the feedback is still in the inbox and says so. Only an admin changes who gets
it, from the inbox.

#### Crossover access (Shared with)

Everyone sees only the clients of their own span: a biller, SME or team lead their
own projects, a manager every project under them, the VP and admins everything.
An account added by hand follows its projects too; only one with no projects at
all (the bootstrap account) still sees everything. Settings has a **What you can
see** card that spells out exactly why an account sees what it sees. For crossovers,
a team lead, manager or the VP can share one client with one person, on the client
card (Clients & locations, "Shared with", also in the person's Team profile under
"Extra client access"):

- **View only**: the client, its claims, dashboards and reports become visible to
  them, nothing can be changed. The card shows "shared · view only".
- **Can edit**: they work it like their own client: upload, allocate, answer
  Needs attention, keep its RACI. A shared biller can be picked in allocation.

Shares are personal (one person, one client), show who shared and when, and can
be taken back any time. SMEs cannot share; a view-only share cannot be passed on.

#### RACI (the first tab)

Everyone from SME up (never billers) gets the **RACI** page: one row per client
with who is **R**esponsible (does the work, the billers), **A**ccountable (owns
the outcome, the team lead), **C**onsulted (asked before decisions, the manager)
and **I**nformed. Until a row is saved it is filled from the roster. Team leads
and managers edit the rows of their own clients (SMEs read); Informed holds at
most two people and the VP is always the first, which cannot be removed.

Each row also counts **missed tasks**, with the claims (patient, who, due,
late by) one click away: **AR** = claims allocated before today and still not
worked by the biller; **Posting** and **Submission** (with rechecks and
rejections) = hand-offs past their 24-hour TAT, still open or finished late
in the last 30 days.

#### Payment Posting, Submission and Rejections

A biller's SAAG action sends a claim to the person set on the client (Clients &
locations): Need to Post / Posting Correction to Payment Posting; resubmissions and
paper claims to Submission; a **Claim Rejected** entry, or a rejected recheck, to the
client's **Rejections** person first (top of their list), else Submission. While it is
there the claim is **In process** for AR (own dashboard card, off the biller's list).

**Purview's workflow in the SAAG entry.** These actions set the effective status and the bucket
themselves (the bucket is locked on the work form, with a "Workflow:" hint):

| Action | Effective | Bucket | What happens |
|---|---|---|---|
| Need to Post / Posting Correction | AR Closed-Pending Posting | Closed | AR's part is done: the claim goes to Posting with no follow-up date |
| Posting marks it Completed | Posting Closed | Closed | The claim closes; only QA is left (a separate workflow, not started yet) |
| Need to Resubmit, Need to Submit Paper Claim, Correction, Resubmission & Reprocessing | Pending-Submission | Purview | Not closed: it goes to Submission (or Rejections first for a rejected claim) |
| Submission marks it Completed | Pending-Collectible Insurance | Payer | Back with the biller: follow-up in 15 days, the 48-hour recheck, any rejection |

When the client has no active Posting person, a posting entry still closes the claim for AR (the form says
to ask the team lead to set one). When it has no active Submission person, the claim stays on the biller's
list with a 15-day follow-up. A claim taken back to a biller while a desk still had it keeps the biller's
own SAAG when the desk finishes.

**After Posting closes a claim, anyone can open it to read.** Search (Ctrl+K) finds it for everyone, marked
"posted · closed". Someone it is not with sees it read only: no entry, no note, no team lead actions, not the
patient's other claims. Its notes are **locked** for everyone, the biller who wrote them and team leads included.
A claim AR closed itself (not posted) stays with its own people.

**Past TAT, inside the tabs (no separate page).** Each tab shows its own reminders: **Posting & submission** has
cards for Open, Past TAT, On hold, Done, Within TAT and Waiting on client (a card filters the list; the client
filter and the dates narrow the cards too), and **Needs attention** has one client filter for all its lists, its tab
counts and its cards for Past 48 working hours, Due in the next 4 hours and On hold. Claims past their TAT are at the
top of each list; one on hold goes after the rest and is no longer counted or shown in red as past the TAT. **Hide claims waiting on the client** takes those out of Open and of the Past
TAT count. A team lead with edit access to the client clicks **Can't close yet** on a row past its TAT (why, and the
expected close date, up to 30 days): no reminders for it until that date, then it is back, marked as past the
expected date; **Clear hold** undoes it. The bell, the red bar on other pages, the Dashboard's pending card and the
09:00 / 19:00 IST reminder emails open these tabs.

Each hand-off has 24 working hours (a TAT tag and bar; red once past). The department
has four choices: **Completed** (with proof), **Pending** (still theirs; the comment
shows on the row and the clock keeps running), **Need assistance from AR** (back on
the biller's list today with the reason; the third return escalates to their team
lead) or **Need assistance from client** (stays In process under Waiting on client;
the 24-hour clock keeps running, and **Client answered** puts it back in the open
list). Every choice takes a comment, required except on Completed and Client
answered. Posting complete closes the claim as Payment posted. Submission complete
sends it back to the biller with a 15-day follow-up and always opens a **recheck after the client's recheck time**
(48 working hours unless the client needs it sooner; never later than 48) for the follow-up person on the client, or
whoever submitted:
**Accepted · final check done**, or **Rejected** (to Rejections, then Submission).

**Filters.** Every lead and team member on Payment posting and Submission can narrow the list to one **client**
and to the dates the claims were **sent to the desk** (All time, Today, This week, This month, Custom). The sent
date is the day the AR biller saved the entry that sent the claim, so the same filter answers "what AR sent on
Monday" and "what reached us on Monday". The counts at the top follow the filters.

**Each client's TAT.** The person setting up the client sets the Payment posting TAT and the Submission TAT in
working hours (Saturday and Sunday not counted; 24 to start). Rejections and the recheck after a resubmission use the
Submission TAT. Only AR has a daily target; Payment posting, Submission and Rejections work to the TAT. The month's
**Submission TAT %** (SLA scorecard, Monday digest, the TAT report in OneDrive) counts every time a claim is sent to
Submission, a first submission or a resubmission, and the Rejections tasks; the recheck after submitting is not counted
(the biller checks the payer has the claim; it still has its own reminders).

**Desk choices.** Completed, In process (comment optional), Pending (with a comment), Need assistance from AR, Need
assistance from client, and Other (with a reason and a comment). In process, Pending and Other keep the claim open
on the desk; the TAT keeps running.

**Recheck by the biller.** After Submission or Rejections resubmits a claim, the biller who worked it sees it on My
day under **Resubmitted · recheck** with the time left on the TAT, and can mark it **Accepted** or **Rejected again**,
as can the recheck person, the Submission and Rejections people and the client's AR team leads. Rejected again goes
straight back to the Rejections person (or Submission) to fix and resubmit, within the client's TAT.

**Supervisor review in Needs attention.** Each escalation (and each claim a department sent back) has **Review**:
four notes (why it came, what was reviewed, the findings, the next action) go on the claim's timeline only (who escalated it and when, who reviewed it, where it went; the claim's notes and work stay as they were), and the claim
goes to the biller who sent it, another biller (first on their list, with a notice), or back to the department that
sent it (with the client's TAT).

**Sent back to AR.** Need assistance from AR goes straight to the biller, first on their list with a notice, and also lands in the client's AR team leads' (and managers') **Needs attention →
Sent back by Posting / Submission**: when, who sent it, the department, the reason and comment, the biller, and how many
times the claim has come back. It counts on the Needs attention badge, turns red after 48 working hours, and leaves the
list once a biller saves an entry on the claim.

### Team tasks (Needs attention → Team tasks, and My tasks)

Work that is not a claim on someone's list: a list the client emailed, an ERA batch, an eligibility run. Team leads,
SMEs and above give it under **Needs attention → Team tasks → + Add task** (Payment posting and Submission team leads, who
have no Needs attention, under **Work → Team tasks**, next to the Escalation tracker):

- the **client** (or none, for an internal task), **received from** (Client, Manager or Internal), the **scope** (AR
  follow-up, Payment posting, Submission, Rejections, Eligibility (EV), Other), the **task** and a **description**;
- the **TAT**: 24 or 72 working hours, another number of working hours, or a date (the end of that day). Working
  hours are Monday to Friday with the Shastra holidays left out, the same clock as every other TAT;
- the **task count**, and **who does it**: one or more people on the team. The count is split evenly and each share
  can be changed (the shares must add up to the count);
- **files** (up to 6, 8 MB each): attach them, paste a screenshot with **Ctrl+V**, or **Add a screenshot** to capture
  the screen.

Each person gets their share with a notice on the bell (and on the computer, if they allowed it). It shows on **My day**
(*Tasks from your team lead*, above the claims) and on **My tasks**, with the TAT bar. **Update** saves how many are
done, the status (**In progress**, **Completed**, **Need help from team lead**: help needs a comment, and so does
Completed with some left), a comment and files. The team lead gets a notice for each update, for a call for help, and
when everyone has completed (the task then closes by itself, within the TAT or not).

The team lead's list has the cards **Open**, **Due in the next 4 hours**, **Past TAT** (at the top, red) and **Done ·
7 days** (how many within the TAT), and each task shows everyone's count. **Open** shows each person's share, their
updates and files in **What happened**, with **Remind** (one person or everyone), **Can't close yet** (a reason and an
expected date, up to 30 days: no past-TAT reminders until then), **Edit or reassign** (the name, the description, the
TAT, add people, change a share; never below what the person has done, and someone who has done some stays on it) and
**Close the task**. A team lead sees the tasks they gave and, with edit access to a client, the ones on that client;
admins and the VP see all. The person given a task sees only their own share and updates.

Past the TAT, the task is on the bell of everyone on it and of the team lead until it is updated, closed or put on
hold, and in the team lead's 19:00 email with the client, the scope, the count done and the due time only (never the
task's name or description). Task items done count on **Dashboard › Team status** (the *Tasks* column and the
attainment).

### Escalation tracker (Work → Escalation tracker)

Client escalations, one register per client. **SMEs and above** log and update them (billers cannot open it), in the
supervisors' format: Department, Client Name, Received date, Raised by, Reported to Purview, Responding person Purview,
Email Subject, Error description, Error (Y/N), Comment, Root Cause, Corrective Action, Preventive Action, Status
(Open / Closed) and Close date. The SR No is given by itself per client (SR1, SR2...). To close one: Error (Y/N), root
cause, corrective and preventive action, and a close date between the received date and today. Nothing is left blank:
to log one, every field is needed: the type, department, client, Location (or All locations), received date, raised
by, reported to, responding person, the Channels used (Email, Teams, Call), the email subject (or a short title when it
did not come by email), the description and a comment. To close it, also Error (Y/N) (who made it and the DOW when it
is our error), the Review date (between the received date and today), Rework completed (Yes / No), the root cause, the
corrective and preventive actions and the close date; Save stays off and the form says what is still needed. Reviewed by
is the Reported to / Responding person; the Review result is the Error (Y/N) answer (Error / No error); the Month comes
from the received date.

**A new escalation** (and one marked as our error later): the project's team leads get a bell notice and an email (the
admins when the client has no team lead), and whoever logged it gets a copy of the email. The client, SR, type,
department and dates only, never the description or the email subject.

**Open over 24 hours** (from when it was logged): the row turns red with *reason needed*, the bell asks the team lead,
and the hourly job sends the client's team leads one notice and email. The **team lead** (not the SME) gives the reason
and the expected close date; if that date passes with the escalation still open, it turns red again for a new date.

**OneDrive:** one workbook per client, `Brahmastra Clients › <Client> › Escalation Tracker - <Client>.xlsx`, rewritten
from the register on every change (so an update or a resolution changes the same row). The columns follow the
supervisors' format above (dates as mm/dd/yy), then hours to close, the 24-hour reason and expected date, who logged
it, the type, error by and DOW, and at the end Location, Month, Channels Used, Review Date, Review Result, Rework
Completed, Logged on and the last update (who and when). The CSV has the same columns. Drishti counts the rows by the Department column for the Escalations KPI. Needs `MS_CLIENT_SECRET` on the
server like the Production files; until then entries are kept in Brahmastra and the whole register goes to the file
with the first change after it is set.

**SLA (threshold 0).** Escalations count on the SLA tab: Drishti's Escalations KPI for AR, Submission, Payment Posting
and EV is green at 0 and red at 1 or more in the period. For it, each month's escalations also go to the client's
`Brahmastra Reports › <Team lead> › <Client> › SLA & KPI › Escalation Tracker - <Client> - Nov 2026.xlsx` (that month's
rows only, since Drishti counts every row of the file, by department). Picking a client on the tracker shows this
month's SLA line: the count against the target of 0, by department.

### Monday digest: a short email and a landscape dashboard

The email is short, in plain tables that hold up in Outlook and on a phone (at most 600 px wide): the header (manager,
designation, period, clients, Total team with Billable FTE and Assign FTE), four numbers (average SLA score, the month's
escalations against the target of 0, AR, over 90), one row per client worst first (TL and SMEs, SLA score and change,
escalations, Billable / Assign FTE, over 90), what needs attention and a button, **Open the full digest in Brahmastra**.

The button opens the **digest dashboard** (`#/digest?span=...&week=...`, also from SLA › Monday digest › Open the
dashboard): landscape, one card per client with its SLA score and band, **Billable FTE** and **Assign FTE**, AR, over 90,
collected, each area's score, the escalation line and what pulls it down, and what needs attention. Pick another span or
one of the 8 weeks before, and download it as a one-page landscape PDF. Supervisors see only the spans they are on.

### Resources from Shastra WFM (SLA scorecard and Monday digest)

Each client's people come from Purview Shastra's **Workforce Management**, worked out the way its Explore page does:
**Billable** (what the manager set for the project in WFM), **Assigned FTE** (working agents split evenly across their
projects, a fresher counting half), **Utilization** (Assigned ÷ Billable), the **team on the project** (everyone,
TLs, SMEs and QA included) and agents **in training / OJT**. Clients are matched to Shastra projects by their roster
project names. The **SLA scorecard** shows **Billable FTE** and **Assign FTE** with the client's **Escalations** for the period (target 0); the
**Monday digest** adds **Total team** to its header (Billable FTE and Assign FTE), each client's Billable FTE and Assign FTE beside its TL and SME names, and the
month's escalations so far (counts only, no descriptions).

To switch it on, run `dev/shastra-wfm-feed.sql` once in Shastra's Supabase (SQL Editor). It adds one read-only
function, `brahmastra_wfm`, that answers with the same `SHASTRA_FEED_KEY` as the roster (no new key) and sends project
names and counts only. Brahmastra reads it with the hourly roster sync; until it is run, the numbers do not show.

**Client requests.** Need assistance from client lands in the client's AR team lead's **Needs attention →
Client requests**: they send it to the client and mark it **Sent** (email, client portal, call, fax; optional
comment). Unsent requests count in the Needs attention badge and turn red after 48 working hours. The department
sees who sent it and when; if the client has not answered 3 working days after sending, the claim comes back to
their Open list as **Chase the client**.

**Warnings and reports.** Hand-offs with under 4 hours left are flagged at the top of the list and in an amber
bar on every screen. A claim returned to AR 3 times is escalated to the AR team lead and listed for the
department lead. Department dashboards show **Needs you now**, **why claims needed AR's help** (by reason and
biller) and, for Submission, **rejections by code** (by code, client and biller). Rejected rechecks and
resubmitted rejections carry a rejection code.
- Each roster project is matched to a client (same name or code automatically;
  otherwise a team lead is asked once). Active AR agents on a project become
  that client's billers.
- Who gets a client's claims is its people on the client card (AR billers on this client; a location's own team
  when it has one), each up to their daily target, minus anyone marked **Out today** on Live status. Automatic
  allocation after an upload and the Allocate screen both use that; there is no daily ticking.
- Roster people sign in only with a Purview email, or an address the admin
  lists under Extra sign-in emails. Self sign-up is closed. People no longer in
  Shastra, or past their exit date, are switched off and their open claims go back
  to the pool; those who never signed in and have no work in Brahmastra are removed.


#### Straight from Purview Shastra (automatic)

The Worker pulls the roster from Shastra's database every hour (`[triggers]` in `wrangler.toml`). Any supervisor
can press **⟳ Sync from Purview Shastra** on the Team tab (at most once every 2 minutes, recorded in the audit
trail), and an admin can press **Sync now** on the Roster page. It applies the changes at once
and keeps a list of what changed (joined, changed, left). Date of joining (DOJ) is kept too. If Shastra sends an
empty or very short list (under half of the active people), nothing is changed and the Roster page says why.

Shastra answers through one read-only database function, `brahmastra_roster(p_key)` (`dev/shastra-roster-feed.sql`, run once in Shastra's Supabase SQL Editor), which returns the roster
export's columns and nothing else, and only for the right key. Shastra stores only the key's hash.

Time on the floor and idle time for Team status come from a second read-only function, `brahmastra_floor(p_key,
p_from, p_to)` (`dev/shastra-floor-feed.sql`, run once the same way). It uses the same key (no new secret) and
returns, for each person and day, the attendance status, time on the floor, time logged in, breaks, and the minutes
Shastra Guard saw no movement or a locked screen while they were punched in; people are matched by Emp ID, then
email. Brahmastra keeps the days it fetched, settles a day once it was fetched 12 hours after it ended, and asks
again for newer days after 10 minutes. Until the function is added, Team status shows – for on floor and idle.

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
email. Sessions last at least 24 hours after the last use and extend while in use.

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

## Each client's folders in OneDrive (Brahmastra Clients)

Every client gets its own folders in the Purviewautomate OneDrive, made by Brahmastra when the client is added (the
hourly job makes them for every existing client, a few per run; admins can press **Make OneDrive folders** on
Clients & locations, or **Make folders now** on one client):

```
Brahmastra Clients / <Client> /
   Inventory        the client's inventory files; Upload inventory > Open OneDrive opens this folder
   Production /
      AR                "AR Production - <Client> - Nov 2026.xlsx": one row per entry a biller saves
      Payment posting   "Payment posting Production - …": one row per claim the posting desk works
      Submission        submissions and the 48-hour rechecks, in the team's Production Format Conso layout
      Rejections        rejected claims worked by the Rejections person
```

Dates are written as Excel dates shown as mm/dd/yyyy and amounts as money, so the files read the same whatever OneDrive's language.
Each desk's rows go to a tab of its own (**Payment posting**, **Submission**, **Rejections**) under that tab's header; a new
month's file starts from the AR template, so its first tab is renamed and given the desk's header. A file that already held
rows in another layout earlier in the month gets a new tab, so no tab mixes two layouts.

- **Submission** uses the team's *Production Format Conso* columns, spelling included: Client (the client code), UID, Date
  (DOS), Patient, Invoice, NAEC Order No, VEC S/W Insurance Name, Insurance, Balance, VEC Patient Balance, Location, Type,
  VEC Claims Sourse, VEC Submission Type, Old status, Old Comment, old bucket, Old Onhold/Pending, Allocation Date,
  Allocation (left blank), DOW, EMPID, Worked by, Inventory Status, Comment, Bucket, Claim Type. Most fill themselves:
  the client's own columns (NAEC, VEC, UID, Type...) come from the client's inventory file row, whatever their case or
  spacing (blank when the file has no such column); the old status, comment and bucket are the inventory file's; UID
  is the file's own, otherwise the same key as the AR file (patient, DOS, payer, CPT). The person types **Inventory
  Status**, **Bucket**, **Claim Type** and **Type** in the Completed form (free text with suggestions for now; Type left
  empty takes the inventory file's; Claim Type starts from the biller's SAAG action), and the comment is the Comment
  column. Pending, Need assistance and the rechecks write their own status, bucket and comment.
- **Payment posting** is one row per claim with what the poster enters in the Completed form from the EOB / ERA:
  Check / EFT #, Check / EFT date, Payment type, Posted date, Allowed, Paid, Adjustment and its reason (e.g. CO-45),
  Deductible, Co-insurance, Co-pay and Write-off (all optional but the check number and posted date), next to what
  Brahmastra knows (client, UID, DOS, patient, invoice, insurance, location, CPT, billed, balance). Patient
  responsibility (deductible + co-insurance + co-pay) and the balance after posting (balance - paid - adjustment -
  write-off) add up by themselves. The amounts must add up: **Allowed = Paid + Deductible + Co-insurance + Co-pay +
  Adjustment**, to the cent, or the claim cannot be marked completed (the form shows the difference; the server checks the same). With no
  amount entered (a posting correction with no payment) there is nothing to check. Paid is also the amount posted the
  reports add up.

A new file starts by itself on the 1st of each month in each folder; nobody links or renames anything. Each folder
gets a link anyone at Purview can open, and supervisors see every path, this month's file and when the last row was
written on the client card (billers do not). If OneDrive refuses a write, the client's AR person and team leads
get a bell notice and an email (once a day), and the card says why; the entry itself is always saved in Brahmastra.
Older workbook links on clients and locations are no longer used.

It needs the **Files.ReadWrite.All application permission** on the Microsoft 365 app (already used for the
sign-in emails). Optional Worker variables: `REPORTS_OWNER` (default `Purviewautomate@purview-healthcare.com`) and
`REPORTS_AUTO=off` to stop it.

Sasha's Third Eye and Drishti still keep their own folders where they were: **Brahmastra Reports / Team lead /
Client / QA tracker, Quality insights, SLA & KPI** (moving them needs changes in those two apps).

## Drishti and Sasha's Third Eye inside Brahmastra

Both apps open **as part of Brahmastra**, not as a page inside a box: with `?embed=1` each hides its own
logo, header and menu, takes the Brahmastra theme (Light, Navy, Gold) and lines up with Brahmastra's edge,
and **Brahmastra draws their tabs in its own tab row** (Drishti: Overview, Clients, Formulas...; Third Eye:
Production, Agent Quality...). A click there opens that tab inside the app (a `brahmastra:hello` /
`embed:tabs` / `brahmastra:go` message handshake). Opened on their own addresses, both apps look and work
exactly as before. Both have their own tabs, first in the bar: **SLA** (the Drishti scorecard) and
**Sasha's Third Eye** (the internal reports; Posting and Submission leads get Quality only, for their own
work; Third Eye's own Team Status tab is not drawn, because Brahmastra's Dashboard has Team status). The client report is **Dashboard › Client 360 report** (Client 360 has a button to it). There is no
My day & reports tab any more: **Claims › Entries** lists every entry the team wrote (with the CSV QA uses), Team
status opens a person's allocations, and a team lead who works claims gets **Work › My desk**.

**Brahmastra's data goes in by itself, with a note.** Nobody exports and re-uploads what Brahmastra already has:
- *Internal reports*: Brahmastra's production (and the roster) loads into the Production Sheet box when the page
  opens and whenever the work, client or dates change.
- *SLA*: when a client's upload page is open in the scorecard, today's AR Inventory for the Brahmastra client
  of the same name is added to it, and the scorecard shows it in its "Check these before they are applied" list,
  so nothing is calculated until someone presses apply.

Each page says what was filled and from where. To use different figures, choose another file in the same box;
it takes the place of Brahmastra's.

Where the reports are, for team leads and above:

| Where | Page | What it is |
|---|---|---|
| Claims › Entries | Every entry | every entry the team wrote with its claim, for any dates, by client, location and biller; CSV in the Production Conso layout, or Brahmastra's columns |
| Dashboard › Team status › allocations | Team allocations | what was allocated to a person and what they worked, the dates picked, with its CSV |
| Sasha's Third Eye tab › Internal reports | Internal reports | Third Eye's Internal Reporting; Brahmastra's production and the roster load into it by themselves |
| Dashboard › Client 360 report | Client 360 report | Brahmastra's own client report (Third Eye's pages and rules) to present, edit and send as a PDF; see *Dashboard › Client 360 report* above (the month-end step "Client pack built" opens it) |
| SLA › SLA scorecard | SLA scorecard | Drishti's scorecard in Client 360's style, read only (see *SLA* above) |
| SLA (Drishti's tabs) | Drishti | Drishti's own pages, signed in, in Brahmastra's theme. **Save AR Inventory to OneDrive** writes the AR Inventory report to the client's SLA & KPI folder for Drishti to pick |

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

**Upload history** lists every batch. **Undo** removes the claims that upload added which nobody has
worked yet (no entry, not open, no attachment); claims already worked stay, so no work is lost. An upload is
undone once.

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
worked, tiers, status, payers, minimum balance); the claims go to the client's people, each up to their daily
target, skipping anyone marked out today (**Change people on the client card** to add or remove someone); choose a
strategy, preview, assign.

- **Smart batching**: every claim of a patient stays with one person, the rest
  are grouped by payer, all in priority order.
- **Payer batching**: fewest payers per person for the most money.
- **Patient batching**: one touch resolves several claims.
- **Straight priority, round robin** and **Balance the dollars**.

**AR follow-up after submission.** When Submission submits a claim it comes back to AR 15 days later. On that
day it joins the pool like any follow-up due (the same points), its priority reason says "AR follow-up after
submission", and it has its own count and tick box on Allocate, so a team lead can send these out or leave them.

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
   PRE CALL CHECK (what was verified before acting) and RCA / FINDINGS. There is no separate
   note ACTION: the action is the one picked in the SAAG entry above it. (Entries written before
   this change keep the ACTION they were saved with.)

The note is stored as **one cell**, for example:

```
DOS: 08/09/2026 | CLM#: 7711130 | DENIAL: TFL - Timely filing | SOURCE: Call, REF: 88120345 | PRE CALL CHECK: Eligibility active on DOS; Claim status with payer | RCA/FINDINGS: ... | SAAG: Claim Denied > TFL Exceeded/No POTFL > Need to Appeal | BUCKET: Client | EFFECTIVE: Pending-Client Assistance | FOLLOW-UP: 11/10/2026
```

A closing entry closes the claim: the SAAG entry's bucket is Closed or its Effective Matrix value is
Processing-Closed or Payment-Cash In Bank. Any other entry sets a follow-up date (14
days for Client Assistance, 7 for Purview internal review, 30 for the
collectible buckets, or the client's default) and the claim comes back into the
allocation pool when the date arrives.

Entries can be **edited at any time** by their author or a team lead (no time
limit); another biller cannot edit them, and each edit shows in the claim history.

### SAAG reference and updates

**SAAG** shows the matrix: pick a status, a sub-status, and see the actions
with their Effective Matrix and bucket. When the workbook changes, run

```
powershell -ExecutionPolicy Bypass -File dev\build-saag.ps1 -Workbook "C:\path\SAAG_Claim_Entry_Tool.xlsx"
```

and commit the new `lib/saag.js`. The whole team gets it on the next refresh.
The bucket mapping lives in `EFFECTIVE_BUCKET` in `index.html`.

### Reports

**Claims › Entries** lists every entry with its claim (worked claims, skips, plain
notes) for a date range, client, location or biller. **Download CSV** gives the
Production Conso layout (the team's consolidation columns, one row per entry);
**Brahmastra columns** gives the SAAG fields, every note field and the one-cell
note. **Team** shows claims worked per person per day. **Claims** exports the
filtered claim list in the Production layout too, one row per claim with its
last SAAG entry (blank work columns for claims nobody worked), or Brahmastra's
own columns. The Claims page's age box also has **Turning 90 in 7 days** and **Turning 90 in 14 days** (open claims
77 to 90 days old by date of service, the same list as the Dashboard's Turning 90 card), so they can be picked with
any other filter, selected and assigned, or downloaded.

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

`dev/serve.ps1` serves the folder on http://localhost:8787 and
`.claude/launch.json` lets Claude Code start it. The Worker runs in the page in
demo mode, so changes to `worker.js` are tested the same way; the production
Worker is the same file.

The app's code is `app/app.jsx`. After changing it, build once (Node 20+):

```
cd tools
npm install          # once
node build.mjs       # writes app/app.js and stamps index.html with its version
npm run check        # build current, lint, API checks, every page for every role
```

Commit `app/app.jsx`, `app/app.js` and `index.html` together. GitHub runs the
same checks on every push (Actions › Checks); a red check means something would
break for people. The browser pass needs Chromium: `npx playwright install
chromium` once (or set `CHROME_PATH` to an installed Chrome).
