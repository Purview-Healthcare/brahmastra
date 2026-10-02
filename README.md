# Purview Brahmastra

Internal departmental coordination console. The AR supervisor uploads the day's
production file for a date of work, the app segregates it into Submission,
Payment Posting, EV Review and Client Assistance worklists, each department
downloads its worklist, works it, and uploads it back, and the board maps
completion automatically with 24 hour TAT tracking and a next day rejection
follow up list.

The whole app is the single `index.html` file.

## Configuration

Open `index.html` in any text editor. The BRAHMASTRA CONFIG block sits at the
very top. Paste your Cloudflare Worker URL into `API_BASE` and your access key
into `API_KEY` to turn on shared multi user mode. With both left empty the app
runs in demo mode, where data stays in one browser session only.

## Data

All shared data (logins, clients, per date boards) lives in Cloudflare KV
through the brahmastra-api Worker, never in this repository. Do not commit
claim files here; the .gitignore blocks the common formats as a guard.
