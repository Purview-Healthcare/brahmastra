/* Browser check of the workflows people do through the screens (the API checks cover the server side):
   inventory upload from a file, allocation, a biller's work entry, the claims and reports CSV, the dashboard
   filter, the theme, month-end, answering an escalation, the posting desk, feedback, TFL / AFL, a new client, team tasks.
   node tools/browser/workflows.cjs   (CHROME_PATH=... to use a local Chromium) */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { REPO, prepareDemo, serve, routeCdn } = require("./demo.cjs");
const OUT = path.join(REPO, "tools", "test-results", "workflows"); fs.mkdirSync(OUT, { recursive: true });
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-03-01", exit_date: null, email: "" }, o);
const FEED = [P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cara Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "cara@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Snail Post", department: "Posting", project: "Lakeview Dental Group", email: "snail@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Joseph Manager", email: "leo@purview-healthcare.com" })];
(async () => {
  const PORT = Number(process.env.BROWSER_PORT) || 8768; // BROWSER_PORT lets two copies of the repo run their checks at once
  const srv = await serve(PORT);
  const url = prepareDemo({ base: "http://localhost:" + PORT });
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await routeCdn(p);
  await p.route("https://qhbgshnqugxqiwdywsas.supabase.co/**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: FEED }) }));
  await p.route(/brahmastra_live/, (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "not set up" }) }));
  const cell = (value, extra) => ({ value, method: "upload", ...(extra || {}) });
  const drMonth = (id, label, from, to, ar, sub, pp, sla) => ({ id, kind: "month", label, range: { from, to }, numDays: 31, createdAt: to + "T09:00:00.000Z", createdBy: "tina@purview-healthcare.com", scopes: { ar: { crit: ar }, submission: { crit: sub }, pp: { crit: pp }, sla: { tasks: sla } }, reports: { inventory: { stub: true, fileName: "AR Inventory report - " + label + ".xlsx" } } });
  const DR = [{ id: "d1", name: "Sunrise Eye Care", ownerName: "Tina Lead", scopes: ["ar", "submission", "pp"], rules: {}, periods: [
      drMonth("p1", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.18, { reason: "Two payers hold 70% of the old balance" }), collectionRate: cell(0.91), denialRate: cell(0.124), daysInAR: cell(28), appeal: cell(0.04), quality: cell(0.965), escalations: cell(0) }, { cleanClaim: cell(0.842), submissionTAT: cell("Met", { method: "manual" }), rejectionRate: cell(0.021) }, { ppTAT: cell("Met", { method: "manual" }), paymentCycle: cell(21), varianceRate: cell(0.012) }, [{ name: "Production SLA", target: "1,380", received: 1380, achieved: 1420 }]),
      drMonth("p0", "September 2026", "2026-09-01", "2026-09-30", { arAging: cell(0.16), collectionRate: cell(0.88), denialRate: cell(0.09), daysInAR: cell(31), quality: cell(0.99), escalations: cell(1) }, { cleanClaim: cell(0.93), submissionTAT: cell("Met") }, { ppTAT: cell("Not Met"), paymentCycle: cell(26) }, [{ name: "Production SLA", target: "1,300", received: 1300, achieved: 1250 }])] },
    { id: "d2", name: "Lakeview Dental Group", ownerName: "Leo Lead", scopes: ["ar", "submission"], rules: {}, periods: [drMonth("p2", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.12), collectionRate: cell(0.93), daysInAR: cell(24) }, { cleanClaim: cell(0.96), rejectionRate: cell(0.02) }, {}, [])] }];
  await p.route(/script\.google\.com/, (r) => { let a = ""; try { a = JSON.parse(r.request().postData() || "{}").a; } catch (e) {} r.fulfill({ contentType: "application/json", body: JSON.stringify(a === "overview" ? { ok: true, value: DR } : { ok: false, code: "auth", error: "stand-in" }) }); });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const t = (ms) => p.waitForTimeout(ms);
  const results = []; let section = "";
  const S = (n) => { section = n; console.log("\n## " + n); };
  const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + JSON.stringify(info).slice(0, 300))); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { ok(name + " (could not run: " + e.message.split("\n")[0].slice(0, 160) + ")", false); await p.screenshot({ path: path.join(OUT, name.replace(/[^a-z0-9]+/gi, "-") + ".png") }).catch(() => {}); } };
  const rpc = (op, pl) => p.evaluate(([o, x]) => window.__rpc(o, x), [op, pl || {}]);
  const toastText = async () => (await p.locator(".toast, .toaster").allInnerTexts().catch(() => [])).join(" | ");
  const pick = async (scope, text) => { await scope.locator(".combo-ctl").first().click(); await t(200); await p.keyboard.type(text); await t(250); await p.locator('.combo-item:has-text("' + text + '")').first().click(); await t(250); };
  await p.goto(url); await t(3000);
  await p.click('button:has-text("Load sample data")'); for (let i = 0; i < 15; i++) { await t(2000); if ((await p.innerText("body")).includes("Dashboard")) break; }
  const tok = await p.evaluate(async (FEED) => {
    const rpc = window.__rpc, sha = window.__sha;
    await rpc("roster.syncShastra");
    const out = { admin: localStorage.getItem("brahmastra2:token") };
    for (const f of FEED) { const k = f.email.split("@")[0]; const m = (await rpc("auth.lookup", { q: f.name.split(" ")[0] })).matches.find((x) => x.name === f.name);
      await rpc("auth.firstPassword", { user_id: m.id, passHash: await sha("pw") }).catch(() => {}); out[k] = (await rpc("auth.login", { email: f.email, passHash: await sha("pw") })).token; }
    window.__setToken(out.admin);
    const us = (await rpc("users.list")).users; const U = (n) => us.find((u) => u.name === n).id;
    const sun = (await rpc("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
    await rpc("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Snail Post") });
    await rpc("clients.saveTeam", { client_id: sun.id, team: [U("Arun Agent"), U("Cara Agent")] });
    await window.__flush();
    out.sun = sun.id; out.arunId = U("Arun Agent"); out.caraId = U("Cara Agent"); out.tinaId = U("Tina Lead"); out.snailId = U("Snail Post");
    return out;
  }, FEED);
  const as = async (who) => { await p.evaluate(async (x) => { if (window.__flush) await window.__flush(); localStorage.setItem("brahmastra2:token", x); }, tok[who]); await p.reload(); await t(3500);
    for (let i = 0; i < 4; i++) { const x = p.locator('.overlay button:has-text("Later"), .overlay button:has-text("Skip for now")').first(); if (await x.count()) { await x.click().catch(() => {}); await t(400); } } };
  const open = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await t(2200); };
  const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), fn()]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };

  S("Inventory upload from a file");
  await as("tina");
  await step("upload", async () => {
    await open("#/inventory"); await t(500);
    const sample = await dl(() => p.click('button:has-text("Download sample fresh inventory")'));
    ok("the sample inventory downloads", fs.existsSync(sample) && fs.statSync(sample).size > 200, sample);
    const before = (await rpc("claims.list", { client_id: tok.sun, page_size: 10 })).total;
    await pick(p.locator(".main"), "Sunrise");
    await p.locator('input[type="file"]').first().setInputFiles(sample); await t(4000);
    if (await p.locator('button:has-text("Load")').count() && !(await p.locator('button:has-text("Upload another file")').count())) { await p.locator('.main button.btn.primary:has-text("Load")').first().click().catch(() => {}); await t(4000); }
    const after = (await rpc("claims.list", { client_id: tok.sun, page_size: 10 })).total;
    ok("the file's claims load (columns recognised by themselves)", after > before || /claims? (added|loaded|refreshed)/i.test(await p.innerText(".main")), [before, after]);
    ok("the result screen offers the next steps", await p.locator('button:has-text("Upload another file")').count() > 0);
    const batches = (await rpc("inventory.batches", { client_id: tok.sun })).batches;
    ok("the upload is in Upload history", batches.some((x) => /sample|fresh/i.test(x.file_name || "")), batches.map((x) => x.file_name));
  });

  S("Allocation");
  await step("allocate", async () => {
    await open("#/allocate"); await t(800);
    await pick(p.locator(".main"), "Sunrise"); await t(1500);
    const txt = await p.innerText(".main");
    ok("the pool and the people show for the client", /pool|claims/i.test(txt) && /Arun Agent/.test(txt), txt.slice(0, 200));
    for (const s of ["Smart batching", "Payer batching", "Patient batching", "Balance the dollars"]) {
      const el = p.locator(`.main :text("${s}")`).first();
      if (await el.count()) { await el.click().catch(() => {}); await t(500); }
    }
    ok("switching strategies shows no error", !errs.length && !(await p.locator(".alert.err").count()), errs);
    const pool0 = (await rpc("claims.list", { client_id: tok.sun, assigned_to: "__none", state: "open", page_size: 10 })).total;
    const prev = p.locator('.main button:has-text("Preview allocation")').first();
    if (await prev.isDisabled()) { const boxes = p.locator('.main label:has-text("Arun Agent") input[type="checkbox"], .main tr:has-text("Arun Agent") input[type="checkbox"]'); if (await boxes.count()) await boxes.first().check(); await t(400); }
    await prev.click(); await t(1500);
    ok("Preview allocation shows the plan", await p.locator('.main button:has-text("Assign ")').count() > 0);
    await p.locator('.main button:has-text("Assign ")').first().click(); await t(2500);
    const pool1 = (await rpc("claims.list", { client_id: tok.sun, assigned_to: "__none", state: "open", page_size: 10 })).total;
    const deskBefore = pool0, deskAfter = pool0 - pool1 + pool0;
    ok("Assign puts claims on the billers' desks (the pool shrinks)", pool1 < pool0, [pool0, pool1]);
  });

  S("A biller's work entry");
  await as("arun");
  await step("work", async () => {
    await open("#/queue"); await t(500);
    await p.locator("button.btn.primary.lg").first().click(); await t(3000);
    const wf = p.locator(".group:has-text(\"SAAG entry\")").first();
    await p.locator('button:has-text("Save & next claim"), button:has-text("Save")').first().click({ trial: true }).catch(() => {});
    ok("an empty entry cannot be saved (Still needed shown)", /Still needed/.test(await p.innerText(".main")));
    await pick(wf.locator(".field").nth(0), "Claim Not On File");
    await pick(wf.locator(".field").nth(1), "Policy Active");
    ok("Claim Not On File > Policy Active can be picked", /Policy Active/.test(await wf.innerText()));
    await pick(wf.locator(".field").nth(2), "Need to Resubmit");
    const note = p.locator(".group:has-text(\"Note · saved\")").first();
    await pick(note.locator(".field:has-text(\"Source\")").first(), "Portal");
    await p.locator("textarea").first().fill("Payer portal shows the claim not on file; policy active on DOS, resubmitting.");
    ok("the Note area has no ACTION field: the SAAG entry carries the action", !/\baction\b/i.test(await note.innerText()), (await note.innerText()).slice(0, 300));
    const preview = await p.locator("text=NOTE PREVIEW").locator("xpath=..").innerText().catch(() => "");
    ok("the note preview builds the one-cell note, with no ACTION part", /SAAG: Claim Not On File > Policy Active > Need to Resubmit/.test(await p.innerText(".main")) && !/ACTION:/.test(preview), preview.slice(0, 200));
    ok("and nothing is still needed once the SAAG entry and the RCA are filled", !/Still needed/.test(await p.innerText(".main")), (await p.innerText(".main")).match(/Still needed[^.]*\./));
    await p.locator('button.btn:text-is("Save")').first().click(); await t(2500);
    const done = await rpc("history.mine", { from_ms: Date.now() - 600000, to_ms: Date.now() + 60000 });
    ok("the entry saves", JSON.stringify(done).includes("Policy Active"), Object.keys(done));
  });

  S("Claims and reports CSV");
  await as("tina");
  await step("csv", async () => {
    await open("#/claims"); await t(1500);
    const f = await dl(() => p.locator('.main button:has-text("Download CSV")').first().click());
    const head = fs.readFileSync(f, "utf8").replace(/^\ufeff/, "").split("\n")[0];
    ok("Claims downloads the CSV in the Production Conso layout (one row per claim, its last entry)", /^Sr\. No,Location,Project,Practice,Uni,IG Claim ID#\/Charge ID#,Patient Name,DOS,Payer,Age,Bucket/.test(head) && /Associate Name,Status,Errors,Team Lead,Date Range,Week/.test(head), head.slice(0, 200));
    const f2 = await dl(() => p.locator('.main button:has-text("Brahmastra columns")').first().click());
    ok("Brahmastra's own columns are still there as a second choice", /Claim #/.test(fs.readFileSync(f2, "utf8").split("\n")[0]));
    await p.locator('.main .seg2 button:has-text("Entries")').click(); await t(2000);
    ok("Claims › Entries: every entry the team wrote (My day & reports is gone)", /Every entry the team wrote/.test(await p.innerText(".main")) && !(await p.locator('.nav > button:has-text("My day")').count()));
    const g = await dl(() => p.locator('.main button:has-text("Download CSV")').first().click());
    const gh = fs.readFileSync(g, "utf8").replace(/^\ufeff/, "").split("\n")[0];
    ok("Entries downloads the Production layout too", /^Sr\. No,Location,Project/.test(gh) && /Date Worked,Emp\. ID,Associate Name/.test(gh), gh.slice(0, 160));
    const g2 = await dl(() => p.locator('.main button:has-text("Brahmastra columns")').first().click());
    const body = fs.readFileSync(g2, "utf8");
    ok("and Brahmastra's columns with the SAAG fields and the note", /status/i.test(body.split("\n")[0]) && body.includes("Policy Active"), body.split("\n")[0].slice(0, 200));
  });

  S("Claims: Turning 90 in the age box");
  await step("turn90-filter", async () => {
    await open("#/claims"); await t(1500);
    // the step before leaves Claims on its Entries tab: back to the claim list
    const tabClaims = p.locator(".main .seg2 button", { hasText: /^Claims$/ });
    if (await tabClaims.count()) { await tabClaims.first().click(); await t(1500); }
    const ctl = p.locator('.main .combo-ctl', { hasText: "Any age" }).first();
    await ctl.click(); await t(400);
    const opts = await p.locator(".combo-item").allInnerTexts();
    ok("the age box offers Turning 90 in 7 days and in 14 days, before the age groups", opts.includes("Turning 90 in 7 days") && opts.includes("Turning 90 in 14 days") && opts.indexOf("Turning 90 in 14 days") < opts.findIndex((x) => /days$/.test(x) && !/^Turning/.test(x)), opts);
    await p.locator('.combo-item:has-text("Turning 90 in 7 days")').first().click(); await t(2000);
    const want = await rpc("claims.list", { turning90: 7, state: "workable", page_size: 1 });
    const shown = ((await p.innerText(".main")).match(/([\d,]+) claims · /) || [])[1];
    ok("picking it lists exactly the claims turning 90 in 7 days (the Dashboard card's list)", shown != null && Number(shown.replace(/,/g, "")) === want.total, [shown, want.total]);
    const back = p.locator('.main .combo-ctl', { hasText: "Turning 90 in 7 days" }).first();
    await back.click(); await t(300); await p.locator('.combo-item:has-text("Any age")').first().click(); await t(1500);
    const all = await rpc("claims.list", { state: "workable", page_size: 1 });
    const shown2 = ((await p.innerText(".main")).match(/([\d,]+) claims · /) || [])[1];
    ok("Any age shows every claim again", shown2 != null && Number(shown2.replace(/,/g, "")) === all.total, [shown2, all.total]);
  });

  S("Dashboard");
  await step("dashboard", async () => {
    // Live status: its own tab, right after Sasha's Third Eye
    await open("#/live"); await t(2500);
    ok("Live status shows the floor", (await p.locator(".dash-team").count()) === 1 && /On the floor now/i.test(await p.locator(".dash-team").innerText()));
    ok("no error on Live status", !(await p.locator(".alert.err").count()));
    ok("a team lead has no team lead filter", !/team lead/i.test(await p.locator(".dash-filters").innerText()));
    // Dashboard: Team status, Inventory status, Client 360 report, Stack report
    await open("#/dashboard"); await t(2500);
    ok("Dashboard opens on Team status", /Team status by team lead/i.test(await p.innerText(".main")));
    ok("Team status has the suggestions", /Suggestions/i.test(await p.innerText(".main")) && /Do today/i.test(await p.innerText(".main")));
    ok("the Dashboard has four tabs: Team status, Inventory status, Client 360 report, Stack report", (await p.locator(".dash-subtabs button").allInnerTexts()).map((x) => x.trim()).join("|") === "Team status|Inventory status|Client 360 report|Stack report", await p.locator(".dash-subtabs button").allInnerTexts());
    await p.locator('.dash-subtabs button:has-text("Inventory status")').click(); await t(3500);
    { const tx = await p.innerText(".main");
      ok("Inventory status: where the inventory stands, age, pace, SLA checks, do these first, by client, claims in detail", /Where the inventory stands/i.test(tx) && /Age of the workable AR/i.test(tx) && /Pace to clear/i.test(tx) && /SLA checks/i.test(tx) && /do these first/i.test(tx) && /Claims in detail/i.test(tx)
        && (await p.locator(".inv-legend button").count()) === 7 && (await p.locator(".inv-it").count()) >= 1 && (await p.locator(".inv-ck tbody tr").count()) === 8, tx.slice(0, 300)); }
    ok("no error on Inventory status", !(await p.locator(".alert.err").count()));
    ok("no Monday digest card on Inventory status", !/Monday digest email/.test(await p.innerText(".main")));
    await open("#/sla"); await t(3500);
    ok("the SLA tab is one embedded app: Drishti's tabs with SLA scorecard and Monday digest beside them", (await p.locator(".ws-tabs button").allInnerTexts()).map((x) => x.trim()).slice(-2).join("|") === "SLA scorecard|Monday digest" && (await p.locator(".rh-iframe").count()) === 1, await p.locator(".ws-tabs button").allInnerTexts());
    ok("no Portfolio sub-tabs on the SLA tab", !(await p.locator(".dash-subtabs").count()));
    await as("sasha"); await open("#/live"); await t(2500);
    const later = p.locator('button:has-text("Later")'); if (await later.count()) { await later.first().click(); await t(500); }
    ok("the VP gets the team lead filter", /team lead/i.test(await p.locator(".dash-filters").innerText()));
    ok("the VP sees billers grouped by team lead", (await p.locator(".dash-team .lead-grp").count()) > 0);
    ok("one SLA tab; no Portfolio & SLA, no My day & reports tab", (await p.locator(".nav > button").filter({ hasText: /^SLA$/ }).count()) === 1 && !(await p.locator('.nav > button:has-text("Portfolio")').count()) && !(await p.locator('.nav > button:has-text("My day")').count()));
    const nm = (await p.locator(".dash-team .biller-link").first().innerText()).replace(/[\s›]+$/, "");
    await p.locator(".dash-team .biller-link").first().click(); await t(2500);
    ok("a biller's name opens their claims", /#\/claims/.test(p.url()) && (await p.innerText(".main")).includes(nm), { url: p.url(), nm });
    ok("Claims is a tab of its own", (await p.locator('.nav > button:has-text("Claims")').count()) === 1);
    await open("#/portfolio"); await t(2000);
    ok("an old Portfolio link opens Dashboard › Inventory status", /on/.test(await p.locator('.dash-subtabs button:has-text("Inventory status")').getAttribute("class")));
    await open("#/dashboard"); await t(2500);
    await p.locator('.main button:has-text("allocations")').first().click(); await t(2500);
    ok("Team status: a person's allocations (allocated and worked, the dates picked) open from their row", (await p.locator('.modal:has-text("Allocations ·")').count()) === 1 && /On desks/i.test(await p.innerText(".modal")));
    await p.keyboard.press("Escape"); await t(600);
    await as("tina");
  });

  S("Settings: theme follows the account");
  await step("theme", async () => {
    await open("#/settings"); await t(800);
    await p.locator('.theme-opt:has-text("Navy")').first().click(); await t(800);
    await p.evaluate(async () => { if (window.__flush) await window.__flush(); localStorage.removeItem("brahmastra:prefs"); }); await p.reload(); await t(3000);
    const th = await p.evaluate(() => document.documentElement.getAttribute("data-theme") || document.body.className);
    ok("Navy stays after reloading (saved to the account)", /navy/i.test(th), th);
    await open("#/settings"); await p.locator('.theme-opt:has-text("Light")').first().click(); await t(500);
  });

  S("Client 360 month-end");
  await step("monthend", async () => {
    await open("#/client"); await t(2500);
    const stepRow = p.locator(".main :text('Internal reports reviewed')").first();
    await stepRow.scrollIntoViewIfNeeded();
    const btn = p.locator(".main button[title*='Mark'], .main .me-step button, .main .c3-step button").first();
    const ov = await rpc("client.overview", { client_id: tok.sun });
    await rpc("monthend.set", { client_id: tok.sun, month: ov.monthend.month, step: "internal", done: true });
    await open("#/dashboard"); await open("#/client"); await t(2000);
    ok("a ticked month-end step shows done with who", /Internal reports reviewed[\s\S]{0,200}done/i.test(await p.innerText(".main")));
  });

  S("Client 360 report (Dashboard)");
  await step("creport", async () => {
    // a little activity in the month the report opens on (last month in the first ten days of a month, else this month)
    const ym = await p.evaluate(async (sun) => {
      const t0 = new Date(), base = t0.getDate() <= 10 ? new Date(t0.getFullYear(), t0.getMonth() - 1, 5, 12) : new Date(t0.getFullYear(), t0.getMonth(), 5, 12);
      const cl = (await window.__rpc("claims.list", { client_id: sun, state: "", page_size: 20 })).rows, at = base.getTime();
      for (let i = 0; i < 6; i++) await window.__sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, bucket, created_at) VALUES (?,?,?,?, 'work', ?,?,?,?,?)",
        "wf-n" + i, cl[i].id, "u", "Arun Agent", i % 2 ? "Claim Denied" : "Claim Paid", i % 2 ? "CO-16 · Missing information" : "Paid in full", i % 2 ? "Appeal filed" : "Closed", i % 2 ? "Payer" : "Closed", at + i * 3600000);
      await window.__sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, done_at, done_by_name, proof_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        "wf-p1", cl[0].id, sun, "posting", "complete", at, "Tina Lead", at + 86400000, at + 3600000, "Snail Post", JSON.stringify({ date: base.toISOString().slice(0, 10), ref: "EFT-9", amount: 125 }));
      if (window.__flush) await window.__flush();
      return base.toISOString().slice(0, 7);
    }, tok.sun);
    // EV rows for the month, as a file picked from OneDrive would give (the picker itself needs the Microsoft sign-in)
    const ev = await rpc("creport.evUpload", { client_id: tok.sun, file_name: "EV production.xlsx", rows: [1, 2, 3, 4, 5].map((d) => ({ wd: ym + "-0" + d, py: d % 2 ? "Aetna" : "Medicare", st: "Active coverage", by: "Riya" })) });
    ok("an EV file is kept for the client", ev.ok && ev.n === 5, ev);
    await open("#/client"); await t(2000);
    ok("Client 360 has no Client report tab and no digest card; a button goes to the Dashboard's report", !(await p.locator(".c3-tabs").count()) && !/Monday digest email/.test(await p.innerText(".main")) && (await p.locator(".main button.c3-report").count()) === 1 && /Open Client 360 report/.test(await p.innerText(".main")));
    await p.locator(".main button.c3-report").click(); await t(4000);
    ok("it opens Dashboard › Client 360 report for that client", /#\/dashboard/.test(p.url()) && /on/.test(await p.locator('.dash-subtabs button:has-text("Client 360 report")').getAttribute("class")) && /Sunrise/.test(await p.locator(".dash-client").innerText()), { url: p.url() });
    const setupText = await p.innerText(".crx-setup").catch(() => "");
    ok("the report starts with the data and the dates", /New client report/.test(setupText) && /EV production\.xlsx/.test(setupText) && /Dates/.test(setupText), setupText.slice(0, 200));
    await p.locator(".crx-create").click(); await t(3000);
    ok("Create dashboard opens it on the executive summary", (await p.locator('.crs[data-page="exec"]').count()) === 1 && /at a glance/.test(await p.innerText(".crx-stage")));
    const order = await p.evaluate(() => [...document.querySelectorAll(".crx-ri .nm")].map((x) => x.firstChild.textContent.trim()));
    ok("the pages run EV, Submission, Rejections, Payment posting, then the AR pages", order.indexOf("EV") === 2 && order.indexOf("EV") < order.indexOf("Submission") && order.indexOf("Payment posting") < order.indexOf("Inventory analysis"), order);
    ok("the pages list has the report's pages, ticked for the PDF", (await p.locator(".crx-ri").count()) >= 10 && (await p.locator(".crx-ri .ck:not(.off)").count()) >= 3);
    await p.locator('.crx-ri:has-text("AR production")').click(); await t(1500);
    ok("AR production shows the entries of the month", /claims worked/i.test(await p.innerText(".crx-stage")), ym);
    const bar = p.locator('.crs [data-dim="payerKey"]').first();
    if (await bar.count()) { await bar.click({ force: true }); await t(1200); ok("clicking a bar filters the page (a chip shows the filter)", (await p.locator(".crx-chip").count()) === 1); await p.locator('.crx-fbar button:has-text("Clear all")').click(); await t(800); ok("Clear all removes it", (await p.locator(".crx-chip").count()) === 0); }
    else ok("a payer bar to click", false);
    const h2 = p.locator(".crs-h2.crs-ed").first();
    await h2.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("Our October AR in one page"); await p.locator(".crx-note").click(); await t(1800);
    const pk = "month:" + ym, got = await rpc("creport.get", { client_id: tok.sun, from: ym + "-01", to: ym + "-28", prev_from: ym + "-01", prev_to: ym + "-01", period_key: pk });
    ok("a changed title is saved for the team", got.edits && got.edits.ar && got.edits.ar.title === "Our October AR in one page", got.edits);
    await p.locator('.crx-bar button:has-text("View as client")').click(); await t(800);
    ok("View as client shows the page without the editing", (await p.locator(".crx-stage .crs-ed").count()) === 0 && (await p.locator(".crx-stage .crs-ct").count()) > 0);
    await p.locator('.crx-bar button:has-text("Edit")').click(); await t(500);
    await p.locator('.crx-bar button:has-text("Present")').click(); await t(1500);
    const c0 = await p.innerText(".crx-pctl b"); await p.keyboard.press("ArrowRight"); await t(600);
    ok("Present shows the pages full screen and the arrow keys move", (await p.locator(".crx-present").count()) === 1 && (await p.innerText(".crx-pctl b")) !== c0);
    await p.keyboard.press("Escape"); await t(600); ok("Esc leaves", (await p.locator(".crx-present").count()) === 0);
    await p.evaluate(() => { window.print = () => { window.__printed = true; }; window.__crHoldPrint = true; });
    await p.locator('.crx-bar button:has-text("Download PDF")').click(); await t(1600);
    const nPages = await p.locator("#crPrint .crx-pp").count(), nTicked = await p.locator(".crx-ri .ck:not(.off)").count();
    ok("Download PDF lays out one page per ticked page and prints", nPages === nTicked && nPages >= 3 && await p.evaluate(() => !!window.__printed), { nPages, nTicked });
    await p.evaluate(() => { window.__crPrintDone && window.__crPrintDone(); window.__crHoldPrint = false; }); await t(400);
    ok("after printing, the page is back", (await p.locator("#crPrint").count()) === 0);
    await p.locator('.crx-bar button:has-text("Change data or dates")').click(); await t(1200);
    ok("Change data or dates goes back to the start", (await p.locator(".crx-setup").count()) === 1);
  });

  S("SLA tab: the scorecard (one line per KPI, moving border), the Monday digest");
  await step("scorecard", async () => {
    await as("tina"); await open("#/sla"); await t(3000);
    await p.locator('.ws-tabs button:has-text("SLA scorecard")').click(); await t(3500);
    const txt = await p.innerText(".main");
    ok("the only client opens by itself: the score dial, the band and the counts", (await p.locator(".sc-big").count()) === 1 && /on target/.test(txt) && /missed/.test(txt) && /October 2026/.test(txt), txt.slice(0, 300));
    ok("one card per scope, one line per KPI with its target zone, cards with the moving border", (await p.locator(".sc-card").count()) >= 3 && (await p.locator(".sc-kp .sc-track").count()) >= 5 && /AR Aging/.test(txt) && (await p.locator(".sc-card.glow").count()) >= 3, { n: await p.locator(".sc-card").count() });
    await p.locator('.sc-kp:has-text("AR Aging")').first().click(); await t(700);
    const mt = await p.innerText(".overlay");
    ok("clicking a KPI shows its formula and the report it comes from", /Formula/i.test(mt) && /Balance in >90-day buckets/.test(mt) && /AR Inventory report/.test(mt), mt.slice(0, 200));
    await p.locator('.overlay button:has-text("Close")').first().click(); await t(400);
    ok("the score trend", /Score ·/i.test(txt));
    const c = await dl(() => p.locator('.main button:has-text("CSV")').first().click());
    ok("the KPI CSV carries the formula column", /Scope,KPI,Value,Standard,Formula,Status,From,Comment/.test(fs.readFileSync(c, "utf8").split("\n")[0]));
    await p.locator('.main .sc-bar button:has-text("Reports")').click(); await t(1500);
    ok("Reports goes back to Drishti's own page, the scorecard tab off", !/on/.test(await p.locator('.ws-tabs button:has-text("SLA scorecard")').getAttribute("class")) && (await p.locator(".rh-frame-body:not([hidden])").count()) === 1 && !(await p.locator(".sc-big").count()));
    await p.locator('.ws-tabs button:has-text("Monday digest")').click(); await t(2500);
    ok("Monday digest is a tab of the SLA tab", /Monday digest email/.test(await p.innerText(".main")) && (await p.locator(".rh-frame-body:not([hidden])").count()) === 0);
    await open("#/dashboard"); await t(2000); await p.locator('.dash-subtabs button:has-text("Inventory status")').click(); await t(3000);
    await p.locator('.main button:has-text("scorecard ›")').first().click(); await t(2500);
    ok("scorecard › on an Inventory status row opens that client's scorecard on the SLA tab", /#\/sla/.test(p.url()) && /on/.test(await p.locator('.ws-tabs button:has-text("SLA scorecard")').getAttribute("class")) && (await p.locator(".sc-big").count()) === 1, { url: p.url() });
  });

  S("Needs attention: review an escalation");
  await step("escalation", async () => {
    await as("arun");
    const q = await rpc("queue.next", {}); const c = q.claim;
    await rpc("queue.complete", { id: c.id, saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Need the TL to confirm the next step", action: "follow up" }, escalate: true });
    await as("tina");
    await open("#/attention"); await t(1500);
    ok("the escalation is listed", (await p.innerText(".main")).includes(c.claim_no));
    await p.locator(`.main tr:has-text("${c.claim_no}") button:has-text("Review")`).first().click(); await t(800);
    const ta = p.locator(".overlay textarea");
    ok("the review has four notes, the first filled in with why it came", (await ta.count()) === 4 && /Escalated by/.test(await ta.nth(0).inputValue()), await ta.count());
    await ta.nth(1).fill("The claim history and the payer portal.");
    await ta.nth(2).fill("The payer needs the reprocessing reference.");
    await ta.nth(3).fill("Call the payer again and ask for the reprocessing reference.");
    ok("it goes to the biller who sent it by default", await p.locator('.overlay input[type="radio"]').first().isChecked());
    await p.locator('.overlay button:has-text("Save review and send")').click(); await t(2000);
    const still = (await rpc("attention.list", {})).rows.some((x) => x.id === c.id);
    ok("reviewing clears it", !still);
  });

  S("Posting desk");
  await step("posting", async () => {
    await as("arun");
    const q = await rpc("queue.next", {}); const c = q.claim;
    await rpc("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: btoa("%PDF-1.4 eob") });
    await rpc("queue.complete", { id: c.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Payment-Cash In Bank" }, note: { source: "Portal", findings: "Paid per EOB, posting needed", action: "follow up" } });
    await as("snail");
    await open("#/handoffs"); await t(2000);
    ok("the claim is on Snail's posting desk", (await p.innerText(".main")).includes(c.claim_no));
    const rowBtn = p.locator(`.main tr:has-text("${c.claim_no}") button:has-text("✓ Completed")`).first();
    if (await rowBtn.count()) await rowBtn.click(); else { await p.locator(`.main tr:has-text("${c.claim_no}")`).first().click(); await t(1500); await p.locator('button:has-text("✓ Completed")').first().click(); }
    await t(800);
    const m = p.locator(".overlay .modal").first();
    const dt = m.locator('input[type="date"]').first(); if (await dt.count()) await dt.fill(new Date().toISOString().slice(0, 10));
    const texts = m.locator('input:not([type="date"]):not([type="checkbox"])');
    for (let i = 0; i < await texts.count(); i++) { const el = texts.nth(i); if (!(await el.isVisible()) || await el.isDisabled()) continue; const ty = (await el.getAttribute("type")) || "", ph = (await el.getAttribute("placeholder")) || ""; await el.fill(ty === "number" || /amount|\$|0\.00/i.test(ph) ? "120.50" : "CHK-" + (1000 + i)); }
    // the EOB amounts must add up (allowed = paid + deductible + co-insurance + co-pay + adjustment): 120.50 = 90.50 + 20 + 10
    const amt = async (label, v) => { const f = m.locator(".field", { hasText: label }).locator('input[type="number"]').first(); if (await f.count()) await f.fill(v); };
    await amt("Allowed", "120.50"); await amt("Paid", "90.50"); await amt("Deductible", ""); await amt("Co-insurance", "20"); await amt("Co-pay", ""); await amt("Adjustment", "10");
    ok("the posting amounts add up, so Mark completed is on", /The amounts add up/.test(await m.innerText()) && await m.locator('button.btn.primary').first().isEnabled());
    await m.locator('button.btn.primary').first().click(); await t(2000);
    const cl = (await rpc("claims.get", { id: c.id })).claim;
    ok("Completed with proof closes the claim as Payment posted", /posted|closed|resolved/i.test(cl.state + " " + (cl.state_reason || "") + " " + (cl.handoff_status || "")), [cl.state, cl.state_reason, cl.handoff_status]);
    await open("#/clients"); await t(1500);
    ok("Snail sees the client he posts for in My clients", /Sunrise Eye Care/.test(await p.innerText(".main")) && /you are responsible here/.test(await p.innerText(".main")));
    ok("with no edit buttons", !(await p.locator('.main button:has-text("Edit profile")').count()));
  });

  S("A biller with no department who does the recheck keeps My day");
  await step("recheck-biller", async () => {
    // made-up: Cara's account has no department (added by hand) and she holds the recheck of a claim she sent to Submission
    // ("the biller who sent it" on the client): she stays an AR biller, with the recheck under Posting & submission
    await p.evaluate(async (x) => {
      const r = await window.__rpc("claims.list", { client_id: x.sun, state: "open", page_size: 1 });
      const now = Date.now();
      await window.__sql("UPDATE users SET department = '', departments_also = '' WHERE id = ?", x.caraId);
      await window.__sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id, assigned_to, available_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        "wf-recheck-1", r.rows[0].id, x.sun, "subcheck", "pending", now - 3 * 86400000, now + 86400000, x.caraId, x.caraId, now - 3600000);
      await window.__flush();
    }, tok);
    await as("cara");
    const navs = await p.$$eval(".nav > button, .nav > .nav-group > button", (b) => b.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    ok("she keeps My day, and the recheck is under Posting & submission (no Submission desk)", navs.some((x) => /^My day/.test(x)) && navs.some((x) => /^Posting & submission/.test(x)) && !navs.some((x) => /^Submission\b/.test(x)), navs);
    await open("#/handoffs"); await t(1500);
    ok("the recheck is listed there", /Submission follow-up|Recheck/i.test(await p.innerText(".main")), (await p.innerText(".main")).slice(0, 300));
  });

  S("Feedback");
  await step("feedback", async () => {
    await as("arun");
    await p.click("button.fb-tab"); await t(600);
    const m = p.locator(".overlay .modal").first();
    await m.locator("textarea").first().fill("Checking that feedback with a screenshot reaches the inbox.");
    await m.locator('button:has-text("Capture this screen")').click(); await t(5000);
    await m.locator('button:has-text("Send feedback")').click(); await t(2500);
    await as("admin");
    const fbl = await rpc("feedback.list", {});
    const item = (fbl.rows || []).find((x) => /reaches the inbox/.test(x.message || ""));
    ok("it lands in the Feedback inbox with the screenshot", item && (item.files || item.file_count || 0) !== 0, item && Object.keys(item));
  });

  S("TFL / AFL");
  await step("limits", async () => {
    await as("tina");
    await open("#/limits"); await t(1500);
    ok("the TFL / AFL page opens with payers", /TFL/.test(await p.innerText(".main")) && !(await p.locator(".alert.err").count()));
    const r = await rpc("payers.saveLimit", { client_id: tok.sun, payer: "Aetna", tfl_days: 90, afl_days: 180 });
    await open("#/dashboard"); await open("#/limits"); await t(1500);
    ok("a saved limit shows on the page", /90/.test(await p.innerText(".main")), r);
  });

  S("New client from the screen");
  await step("newclient", async () => {
    await as("admin");
    await open("#/clients"); await t(1500);
    await p.click('button:has-text("Add client")'); await t(600);
    const m = p.locator(".overlay .modal").first();
    ok("Create client is off until everything is filled", await m.locator('button:has-text("Create client")').isDisabled());
    await m.locator('input[placeholder^="e.g. Dr. Montella"]').fill("Dr. Montella Eye Care");
    await m.locator('label.scope-opt:has-text("AR follow-up")').click(); await m.locator('label.scope-opt:has-text("Payment posting")').click();
    await m.locator('input[placeholder^="Location name"]').fill("Main Office"); await m.locator('button:has-text("Add")').first().click();
    const tg = m.locator('input[placeholder="claims a day"]'); ok("no target box for Payment posting (AR only)", (await tg.count()) === 1, await tg.count()); await tg.nth(0).fill("45");
    const tat = m.locator('input[placeholder="24"]'); ok("a TAT box for Payment posting, in working hours, starting at 24", (await tat.count()) === 1 && (await tat.inputValue()) === "24", await tat.count());
    const row = (l) => m.locator('.row:has(> b:text-is("' + l + '"))');
    await pick(row("AR follow-up"), "Tina Lead"); await pick(row("Payment posting"), "Snail Post");
    await m.locator('button:has-text("Create client")').click(); await t(2500);
    ok("the client is created", /Dr\. Montella Eye Care/.test(await p.innerText(".main")));
    await as("snail");
    ok("the posting person sees it straight away", (await rpc("clients.list")).clients.some((c) => c.name === "Dr. Montella Eye Care"));
  });

  S("Live status: Shastra, the not-logged-in alert, equal reallocation");
  await step("shastra-live", async () => {
    // Shastra now: Arun has no punch 65 minutes into the shift; Cara punched in
    const IST = 330 * 60000, hm = (ms) => new Date(ms + IST).toISOString().slice(11, 16), n0 = Date.now(), shift = (st) => hm(st) + "-" + hm(st + 9 * 3600000);
    const day = new Date(n0 + IST - 5 * 3600000).toISOString().slice(0, 10);
    const rows = [{ emp_id: "A1", email: "arun@purview-healthcare.com", shift: shift(n0 - 65 * 60000), status: "", in_at: null, out_at: null, break_since: null },
      { emp_id: "A3", email: "cara@purview-healthcare.com", shift: shift(n0 - 2 * 3600000), status: "present", in_at: new Date(n0 - 2 * 3600000).toISOString(), out_at: null, break_since: null }];
    await p.route("**/rest/v1/rpc/brahmastra_live", (rt) => rt.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, day, rows }) }));
    await p.evaluate(async () => { await window.__sql("DELETE FROM settings WHERE key = 'live_sync'"); await window.__flush(); });
    await as("tina"); await open("#/live"); await t(3500);
    ok("the pop-up tells the team lead Arun has not logged in, with the claims and the equal plan", (await p.locator(".miss-modal").count()) === 1 && /Arun Agent has not logged in/.test(await p.innerText(".miss-modal")) && /Cara Agent/.test(await p.innerText(".miss-modal")));
    await p.locator('.miss-modal button:has-text("Remind me in 30 min")').click(); await t(1500);
    ok("Remind me in 30 min closes it", (await p.locator(".miss-modal").count()) === 0);
    const live = await p.innerText(".dash-team");
    ok("Live status: the Shastra column (Not logged in, Present) and the red line, no Coaching button", /Not logged in/.test(live) && /Present/.test(live) && /has not logged in to Shastra/.test(live) && !/Coaching/.test(live), live.slice(0, 300));
    p.once("dialog", (d) => d.accept());
    await p.locator('.sh-alert button:has-text("Reallocate")').first().click(); await t(2500);
    const after = await p.innerText(".dash-team");
    ok("Reallocate shares Arun's untouched claims and marks Arun out", /Out today/.test(after) && !/has not logged in to Shastra/.test(after), after.slice(0, 300));
    await as("cara"); await t(1500);
    ok("Cara sees the banner: new claims were allocated to her", /new claims? (were|was) allocated to you/.test(await p.innerText(".main")));
    await p.locator('.alloc-note button:has-text("OK")').click(); await t(1500);
    ok("OK closes the banner", (await p.locator(".alloc-note").count()) === 0);
    await p.unroute("**/rest/v1/rpc/brahmastra_live");
    await p.evaluate(async () => { await window.__sql("DELETE FROM settings WHERE key = 'live_sync'"); await window.__flush(); });
    await as("tina");
  });

  S("Team tasks: a team lead gives a task, the billers update it, it counts on Team status");
  await step("team-tasks", async () => {
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const comboWith = (scope, txt) => scope.locator(".combo").filter({ has: p.locator(".combo-val", { hasText: txt }) }).first();
    // a short list has no search box (a space typed on the button would close it): click the name, searching first when there is a box
    const choose = async (combo, text) => { await combo.locator(".combo-ctl").click(); await t(250); const q = p.locator(".combo-list input.combo-q");
      if (await q.count()) { await q.fill(text.split(" ")[0]); await t(250); } await p.locator('.combo-item:has-text("' + text + '")').first().click(); await t(300); };
    await as("tina"); await open("#/attention"); await t(800);
    await p.locator('.main .seg2 button:has-text("Team tasks")').click(); await t(1500);
    ok("Needs attention has a Team tasks tab with + Add task", (await p.locator('.main button:has-text("+ Add task")').count()) === 1);
    await p.locator('.main button:has-text("+ Add task")').click(); await t(800);
    const m = p.locator(".overlay .modal").first();
    ok("Assign task is off until the task is filled in", await m.locator('button:has-text("Assign task")').isDisabled());
    await choose(comboWith(m, "No client"), "Sunrise Eye Care");
    await m.locator('.seg2 button:text-is("Client")').click();
    await m.locator('.seg2 button:text-is("AR follow-up")').click();
    await m.locator('input[placeholder="What is to be done, in a few words"]').fill("Call back on the October denials");
    await m.locator("textarea").first().fill("The list is in the client's portal. Note the reference number on each claim.");
    await m.locator("label.field", { hasText: "Task count" }).locator("input").fill("10");
    await choose(comboWith(m, "Add someone"), "Arun Agent"); await choose(comboWith(m, "Add someone"), "Cara Agent");
    const shares = await m.locator(".chip.on input").evaluateAll((xs) => xs.map((x) => x.value));
    ok("the count of 10 is split evenly: 5 and 5", shares.join(",") === "5,5", shares);
    await m.locator('input[type="file"]').setInputFiles({ name: "denials-list.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") }); await t(600);
    ok("an added picture shows small before it is saved", (await m.locator(".task-shot img").count()) === 1);
    await m.locator('button:has-text("Assign task to 2 people")').click(); await t(2000);
    const tl = await rpc("tasks.list", {}); const task = tl.rows.find((x) => x.title === "Call back on the October denials");
    ok("the task is saved with both people, their shares, the file and a 24 working-hour TAT", task && task.people.length === 2 && task.people.every((x) => x.share === 5) && task.files === 1 && task.tat_hours === 24 && task.source === "Client", task);
    ok("it is listed on Team tasks", /Call back on the October denials/.test(await p.innerText(".main")));
    await as("arun");
    const navs = await p.$$eval(".nav > button, .nav > .nav-group > button", (b) => b.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    ok("Arun has a My tasks tab with a count", navs.some((x) => /^My tasks\s*1/.test(x)), navs);
    ok("My day shows Tasks from your team lead", /Tasks from your team lead/.test(await p.innerText(".main")) && /Call back on the October denials/.test(await p.innerText(".main")));
    const bell = await rpc("notify.list", { today: new Date().toISOString().slice(0, 10) });
    ok("the bell has the new task from Tina", (bell.items || []).some((x) => /^task_new:/.test(x.key) && /Tina Lead/.test(x.text)), (bell.items || []).map((x) => x.key));
    await p.locator('.card:has-text("Tasks from your team lead") button:has-text("Update")').first().click(); await t(1200);
    const u = p.locator(".overlay .modal").first();
    await u.locator('input[type="number"]').first().fill("3");
    await u.locator("textarea").first().fill("Called 3 so far, the rest after lunch.");
    await u.locator('button:has-text("Save update")').click(); await t(2000);
    const mine = (await rpc("tasks.mine", {})).rows.find((x) => x.title === "Call back on the October denials");
    ok("Arun's update is saved: 3 of 5, in progress", mine && mine.done === 3 && mine.status === "in_progress", mine);
    await as("tina"); await open("#/attention"); await t(800);
    await p.locator('.main .seg2 button:has-text("Team tasks")').click(); await t(1500);
    const row = p.locator('.main tr:has-text("Call back on the October denials")').first();
    ok("the team lead sees 3 of 10 done and a new update", /3 of 10/.test(await row.innerText()) && /new update/.test(await row.innerText()), await row.innerText());
    await row.locator('button:has-text("Open")').click(); await t(1500);
    ok("the task shows Arun's update with his comment", /Arun Agent: 3 of 5 done, in progress/.test(await p.innerText(".overlay")) && /Called 3 so far/.test(await p.innerText(".overlay")));
    await p.locator('.overlay button:has-text("Close")').first().click(); await t(800);
    await open("#/dashboard"); await p.locator('.dash-subtabs button:has-text("Team status")').click(); await t(3500);
    const head = await p.locator(".main table.ts thead").innerText();
    const arun = await p.locator('.main table.ts tr:has-text("Arun Agent")').first().innerText();
    const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const ra = ((await rpc("team.status", { from: todayIst, to: todayIst, today: todayIst })).rows || []).find((x) => x.name === "Arun Agent");
    ok("Team status has a Tasks column and Arun's 3 task items count with his claims", /\btasks\b/i.test(head) && /\b3\s*items/.test(arun) && ra && ra.task_items_today === 3 && ra.count_today === ra.worked_today + 3,
      [head, arun.replace(/\s+/g, " ").slice(0, 300), ra && { items: ra.task_items_today, count: ra.count_today, claims: ra.worked_today }]);
  });


  S("Stack report: the month worked out, a typed PKT, the ticks, the lock, My stack, the Excel, the unlock");
  await step("stack-report", async () => {
    const XLSX = require("xlsx");
    // the month before this one in India, and Purview Shastra's days for it: Arun in every working day, 8 h 05 on the floor;
    // Cara on approved leave the first working day, late the second, a 75-minute break the third, 7 h 40 a day
    const ist = new Date(Date.now() + 330 * 60000), m0 = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
    const M = m0.toISOString().slice(0, 7), label = m0.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), mon = label.split(" ")[0];
    const days = []; for (let d = m0; d.getUTCMonth() === m0.getUTCMonth(); d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10));
    const work = days.filter((d) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; });
    const F = (emp, date, status, tof, brk = 45) => ({ emp_id: emp, email: "", date, status, open: false, tof_min: tof, logged_min: tof + brk, break_min: brk, guard: false, idle_min: 0, locked_min: 0 });
    const FLOOR = [...work.map((d) => F("A1", d, "present", 485)), ...work.map((d, i) => (i === 0 ? F("A3", d, "approved_leave", 0, 0) : F("A3", d, i === 1 ? "late" : "present", 460, i === 2 ? 75 : 45)))];
    await p.route(/brahmastra_floor/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) { /* none */ }
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: FLOOR.filter((x) => x.date >= b.p_from && x.date <= b.p_to) }) }); });
    // the month's work, as Team status counts it: Arun 112% of 30 a day, Cara 97% of hers (her day of leave has no target)
    const nA = Math.round(work.length * 30 * 1.12), nC = Math.round((work.length - 1) * 30 * 0.97);
    await p.evaluate(async ([day, ids, nA, nC]) => {
      await window.__sql("DELETE FROM settings WHERE key = 'floor_sync'");
      const at = Date.parse(day + "T00:00:00Z") - 330 * 60000 + 11 * 3600000;
      const c = (await (await getLocalBackend()).env.DB.prepare("SELECT id FROM claims ORDER BY id LIMIT 1").all()).results[0].id;
      for (const [uid, n] of [[ids.arunId, nA], [ids.caraId, nC]]) {
        await window.__sql(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at)
          SELECT 'wf-stk-' || ? || '-' || i, ?, ?, 'x', 'work', ? + i * 1000 FROM n`, n, uid, c, uid, at);
        await window.__sql("UPDATE users SET capacity = 30 WHERE id = ?", uid);
      }
      await window.__flush();
    }, [work[0], { arunId: tok.arunId, caraId: tok.caraId }, nA, nC]);
    const row = (n) => p.locator(`.main table.stk-t tr:has-text("${n}")`).first();
    const openStack = async () => { await open("#/dashboard"); await p.locator('.dash-subtabs button:has-text("Stack report")').click(); await t(4000); };
    // the team lead: her own team, the month before, a draft
    await as("tina"); await openStack();
    let tx = await p.innerText(".main");
    ok("a team lead opens the Stack report on the month before: her team, grouped under her, a draft", new RegExp(label).test(await p.locator(".stk-bar").innerText()) && /Tina Lead's team/.test(tx) && /Arun Agent/.test(tx) && /Cara Agent/.test(tx) && /Draft/.test(await p.locator(".stk-state").innerText()), tx.slice(0, 300));
    ok("the KPI row: people listed, floor average, a tile for each Stack 5 to 0, to enter", (await p.locator(".stk-kpis .kpi").count()) === 9 && /PEOPLE LISTED\s*2/i.test(await p.locator(".stk-kpis").innerText()), await p.locator(".stk-kpis").innerText());
    ok("a team lead has no team lead stack while the month is a draft, and cannot lock", !(await p.locator('.main .seg2 button:has-text("Team lead stack")').count()) && !(await p.locator(`.main button:has-text("Lock ${mon}")`).count()));
    ok("Arun: his month's work against his target, as Team status counts it (Productivity 10); PKT and quality still to type", new RegExp(nA + " / " + work.length * 30).test(await row("Arun Agent").innerText()) && (await row("Arun Agent").locator("td:nth-child(4)").innerText()).trim() === "10" && (await row("Arun Agent").locator("button.typed.need").count()) === 2, await row("Arun Agent").innerText());
    // a typed PKT: the yellow cell opens, takes the percentage and shows who typed it
    await row("Arun Agent").locator("td:nth-child(14) button.typed").click(); await t(800);
    ok("the PKT cell opens a small form for Arun's PKT score", /PKT score · Arun Agent/.test(await p.locator(".overlay .modal").first().innerText()));
    await p.locator(".overlay .modal input").first().fill("100"); await p.locator('.overlay button.primary:has-text("Save")').click(); await t(2500);
    await row("Arun Agent").locator("td:nth-child(5) button.typed").click(); await t(800);
    await p.locator(".overlay .modal input").first().fill("99.2"); await p.locator('.overlay button.primary:has-text("Save")').click(); await t(2500);
    tx = (await row("Arun Agent").innerText()).replace(/\s+/g, " ");
    ok("Arun's PKT (100%: 2) and quality (99.2%: 10) are typed: 40 of 40, 100%, Stack 5", /100%/.test(tx) && /99\.2%/.test(tx) && /\b40 100% 5$/.test(tx), tx);
    ok("the typed cell says who typed it", /Typed by Tina Lead/.test(await row("Arun Agent").locator("td:nth-child(14) button.typed").getAttribute("title")));
    const cell = async (n, i) => (await row(n).locator(`td:nth-child(${i})`).innerText()).trim();
    ok("Cara: a day of approved leave (AL 1), late once (0.5), one break over the hour (0.5)", (await cell("Cara Agent", 7)).replace(/\s+/g, " ") === "1 · 0" && await cell("Cara Agent", 9) === "1" && await cell("Cara Agent", 10) === "0.5"
      && await cell("Cara Agent", 11) === "1" && await cell("Cara Agent", 12) === "0.5", (await row("Cara Agent").innerText()).replace(/\s+/g, " "));
    await row("Arun Agent").locator("td:nth-child(2)").click(); await t(1000);
    tx = await p.locator(".overlay .modal").first().innerText();
    ok("a click on a person shows how it was worked out: what Brahmastra found, the band, the score and where it came from", /What Brahmastra found/i.test(tx) && /110\.51% and above → 10/.test(tx) && /Brahmastra/.test(tx) && /Shastra/.test(tx) && /Typed · Tina Lead/.test(tx), tx.slice(0, 400));
    await p.keyboard.press("Escape"); await t(500);
    await p.locator('.main button:has-text("How it is worked out")').click(); await t(800);
    ok("How it is worked out lists the bands in plain words (read-only)", /99\.51% to 110\.5% → 8/.test(await p.locator(".overlay .modal").first().innerText()) && !(await p.locator(".overlay .modal input").count()));
    await p.keyboard.press("Escape"); await t(500);
    // phone width: the page does not scroll sideways, the table does inside its card
    await p.setViewportSize({ width: 390, height: 860 }); await t(1000);
    const w = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, wrap: document.querySelector(".stk-card .table-wrap").scrollWidth, box: document.querySelector(".stk-card .table-wrap").clientWidth }));
    ok("at phone width only the table scrolls sideways, inside its card", w.page <= 392 && w.wrap > w.box, w);
    await p.setViewportSize({ width: 1440, height: 950 }); await t(800);
    // a month with nobody in it yet (before everyone joined)
    await open("#/dashboard?tab=stack&month=2026-02"); await t(3000);
    ok("an empty month says so", /Nothing for this month yet/.test(await p.innerText(".main")), (await p.innerText(".main")).slice(0, 200));
    // the manager: both stacks, the ticks, the download, the lock
    await as("joseph"); await openStack();
    await p.locator('.main .seg2 button:has-text("Team lead stack")').click(); await t(1200);
    ok("the manager sees the team lead stack: Tina's row from her whole team", /Tina Lead/.test(await p.locator(".main table.stk-t").innerText()));
    await row("Tina Lead").locator("button.ticks").first().click(); await t(800);
    const tm = p.locator(".overlay .modal").first();
    for (const k of ["4 Quality sessions", "One on One", "Daily Huddle", "Training", "Issue Resolution"]) await tm.locator(`.stk-tickrow:has-text("${k}") button:text-is("Yes")`).click();
    await tm.locator('button.primary:has-text("Save")').click(); await t(2500);
    ok("the manager ticks Tina's five Team handling ticks: 5 of 5", (await row("Tina Lead").locator(".tick.y").count()) === 5 && /\b5\b/.test(await row("Tina Lead").locator("td:nth-child(15)").innerText()), await row("Tina Lead").innerText());
    await p.locator('.main .seg2 button:has-text("Associate stack")').click(); await t(800);
    // the Excel download in her layout; a name starting with = stays text
    await p.evaluate(async (id) => { await window.__sql("UPDATE users SET name = '=SUM(1,1) Cara' WHERE id = ?", id); await window.__flush(); }, tok.caraId);
    await open("#/dashboard?tab=stack&month=" + M); await t(500); await p.reload(); await t(4500);
    const f = await dl(() => p.locator('.main button:has-text("Download Excel")').click());
    const wb = XLSX.readFile(f, { cellNF: true, cellFormula: true }), sh = wb.Sheets["Stack Sheet"], cellAt = (a) => sh[a] || {};
    const rowOf = (r) => { const out = []; for (let c = 0; c < 40; c++) { const x = sh[XLSX.utils.encode_cell({ r, c })]; out.push(x ? x.v : ""); } return out; };
    const head = rowOf(1).slice(0, 36).join(",");
    ok("Download Excel: Stack Sheet, Associate Stack and TL Stack", wb.SheetNames.join("|") === "Stack Sheet|Associate Stack|TL Stack", wb.SheetNames);
    ok("the Team Member Stack under her group headers, in her column order", ["A1", "F1", "L1", "O1", "V1", "AF1", "AH1", "AK1"].map((a) => cellAt(a).v).join("|") === "Month|Productivity 10|Quality 10|Attendance 10|Others 5|TOS 5|Total Score 40|Attriation"
      && head === "Month,ECN,Name,DOJ,Title,Achieved,Expected,Percentage,AVR Production,Avr Target,Score,Achieved,Expected,Score,AL,LWP,Total,Total Working Day,Total Present Day,Shrinkage,Score,Login/Logout Adherence,Score,Break adherence,Score,Total Adherence,Team Player,Score,PKT Scores,Score,Total Score out of 5,Average TOS,Score,Total Score,Percentage,Stack", head);
    const all = Object.keys(sh).filter((k) => k[0] !== "!").map((k) => [k, sh[k]]);
    const ar = all.find(([, x]) => x.v === "Arun Agent"), cara = all.find(([, x]) => String(x.v).includes("SUM(1,1)"));
    const ra = ar && XLSX.utils.decode_cell(ar[0]).r, val = (c) => sh[XLSX.utils.encode_cell({ r: ra, c })] || {};
    ok("values, not formulas: dates are dates, percentages percentages, numbers numbers", ar && val(0).t === "n" && /m/.test(val(0).z || "") && val(3).t === "n" && /yy/.test(val(3).z || "") && val(7).t === "n" && /%/.test(val(7).z || "") && val(35).v === 5 && val(33).v === 40 && !all.some(([, x]) => x.f),
      ar && [0, 3, 7, 33, 35].map((c) => [val(c).t, val(c).v, val(c).z]));
    ok("a name starting with = stays text in the file, never a formula", cara && cara[1].t === "s" && cara[1].v === "=SUM(1,1) Cara" && !cara[1].f, cara);
    ok("the TL STACK table is under it with Tina's row", all.some(([, x]) => x.v === "TL STACK") && all.some(([, x]) => x.v === "Tina Lead") && all.some(([, x]) => x.v === "Addition Point"));
    await p.evaluate(async (id) => { await window.__sql("UPDATE users SET name = 'Cara Agent' WHERE id = ?", id); await window.__flush(); }, tok.caraId);
    await p.reload(); await t(4500);
    // the lock: what is still empty first, then the snapshot
    await p.locator(`.main button:has-text("Lock ${mon}")`).click(); await t(900);
    tx = await p.locator(".overlay .modal").first().innerText();
    ok("Lock lists what is still empty and asks first: Cara's PKT and quality, Tina's Client forefront ticks", /Still empty/.test(tx) && /PKT scores/.test(tx) && /Cara Agent/.test(tx) && /Ticks not ticked yet/.test(tx), tx.slice(0, 400));
    await p.locator(`.overlay .modal button.primary:has-text("Lock ${mon}")`).click(); await t(4000);
    ok("the month is locked by the manager, and stays on screen", new RegExp("Locked by Joseph Manager").test(await p.locator(".stk-state").innerText()) && new RegExp(label).test(await p.locator(".stk-bar").innerText()), await p.locator(".stk-bar").innerText());
    const audits = await p.evaluate(async () => (await (await getLocalBackend()).env.DB.prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'stack.%'").all()).results);
    ok("the lock is in the audit trail", audits.some((x) => x.action === "stack.lock" && x.detail.includes(label + " locked")), audits);
    // the associate: My stack on My day, the locked month only
    await as("arun"); await open("#/queue"); await t(1500);
    const card = p.locator(".stk-mine").first();
    ok("Arun's My day has My stack: Stack 5, 40 of 40, locked by Joseph Manager", (await card.count()) === 1 && /MY STACK/.test(await card.innerText()) && /40 of 40/.test(await card.innerText()) && /Locked by Joseph Manager/.test(await card.innerText()), (await card.count()) ? await card.innerText() : "no card");
    await card.click(); await t(900);
    ok("it opens how it was worked out, as locked, with nothing to type", /Locked: this is the month as it was locked/.test(await p.locator(".overlay .modal").first().innerText()) && !(await p.locator(".overlay .modal button.typed").count()));
    await p.keyboard.press("Escape"); await t(400);
    ok("an associate cannot open the Stack report itself (the server says no)", !(await rpc("stack.month", {}).then(() => true).catch(() => false)));
    // the team lead: her own row of the team lead stack once locked; typed cells closed
    await as("tina"); await open("#/dashboard?tab=stack&month=" + M); await t(500); await p.reload(); await t(4500);
    ok("once locked, the team lead's cells are closed", !(await p.locator(".main table.stk-t button.typed").count()) && /Locked by/.test(await p.locator(".stk-state").innerText()));
    await p.locator('.main .seg2 button:has-text("Team lead stack")').click(); await t(1000);
    ok("and she sees her own team lead row", (await p.locator(".main table.stk-t tbody tr").count()) === 1 && /Tina Lead/.test(await p.locator(".main table.stk-t").innerText()));
    // the admin unlocks: a draft again, in the audit trail
    await as("admin"); await open("#/dashboard?tab=stack&month=" + M); await t(500); await p.reload(); await t(4500);
    await p.locator(`.main button:has-text("Unlock ${mon}")`).click(); await t(800);
    await p.locator(`.overlay .modal button.danger:has-text("Unlock ${mon}")`).click(); await t(4000);
    const au2 = await p.evaluate(async () => (await (await getLocalBackend()).env.DB.prepare("SELECT action FROM audit_log WHERE action = 'stack.unlock'").all()).results);
    ok("the admin unlocks it: a draft again, in the audit trail", /Draft/.test(await p.locator(".stk-state").innerText()) && au2.length === 1, await p.locator(".stk-bar").innerText());
    await p.unroute(/brahmastra_floor/);
    await p.evaluate(async () => { await window.__sql("DELETE FROM settings WHERE key = 'floor_sync'"); await window.__flush(); });
    await as("tina");
  });

  // last, as it fakes OneDrive for the rest of the run
  S("Stack report: extra production from a file in OneDrive (OneDrive faked)");
  await step("extra-production", async () => {
    const XLSX = require("xlsx");
    // the day of work: the last weekday before today in India (a finished day); its month is the Stack report's month on screen
    const ist = new Date(Date.now() + 330 * 60000); let dd = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - 1));
    while (dd.getUTCDay() === 0 || dd.getUTCDay() === 6) dd = new Date(dd.getTime() - 86400000);
    const DOW = dd.toISOString().slice(0, 10), XM = DOW.slice(0, 7), serial = Math.round((Date.parse(DOW + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000);
    // the team lead's made-up production file: 3 rows for Arun (by Emp ID), 2 for Cara (her name in another case), 2 names not found
    // (one written as markup, which must show as text) and a row with no DOW
    const NAME = "Extra production - Tina Lead.xlsx";
    const aoa = [["DOW", "Emp ID", "User Name", "Task"], ...Array(3).fill([serial, "A1", "Arun Agent", "Eligibility check"]), ...Array(2).fill([serial, "", "cara  AGENT", "Portal follow-up"]),
      [serial, "", "Sona Sample", "Form"], [serial, "", "<b>Bold</b> Sample", "Form"], ["", "A1", "Arun Agent", "Form"]];
    const wbx = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet(aoa), "Extra work");
    const FILE = Buffer.from(XLSX.write(wbx, { type: "buffer", bookType: "xlsx" })).toString("base64");
    // OneDrive faked through the page's own hook (window.__BRAHMASTRA_MS_MOCK): the team lead's OneDrive, one folder, the file
    await p.addInitScript(({ FILE, NAME }) => {
      const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
      const item = (id, name, file) => ({ id, name, size: file ? 9000 : 0, file: file ? { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } : undefined, folder: file ? undefined : { childCount: 1 },
        lastModifiedDateTime: "2026-11-12T10:00:00Z", lastModifiedBy: { user: { displayName: "Tina Lead" } }, parentReference: { driveId: "b!wfDrive" },
        webUrl: "https://purviewhealthcare-my.sharepoint.com/personal/tina_lead/Documents/" + encodeURIComponent(name) });
      window.__BRAHMASTRA_MS_MOCK = { account: async () => ({ username: "tina@purview-healthcare.com" }), signIn: async () => ({ username: "tina@purview-healthcare.com" }), token: async () => "stand-in-token", forget: async () => {},
        fetch: async (url) => { const u = String(url);
          if (/\/me\/drive\/root\?/.test(u)) return J(item("root", "root"));
          if (/\/items\/root\/children/.test(u)) return J({ value: [item("fold1", "Production files")] });
          if (/\/items\/fold1\/children/.test(u)) return J({ value: [item("xp1", NAME, true)] });
          if (/\/items\/xp1\?/.test(u)) return J({ ...item("xp1", NAME, true), "@microsoft.graph.downloadUrl": "https://download.invalid/xp1" });
          if (/download\.invalid\/xp1/.test(u)) return new Response(Uint8Array.from(atob(FILE), (c) => c.charCodeAt(0)), { status: 200 });
          return new Response("{}", { status: 404 }); } };
    }, { FILE, NAME });
    const pickIt = async () => { await p.locator(".stk-xbtn").first().click(); await t(1500); await p.locator('.overlay tr:has-text("Production files")').first().click(); await t(1500);
      await p.locator(`.overlay tr:has-text("${NAME}")`).first().click(); await t(3000); };
    await as("tina"); await open("#/dashboard?tab=stack&month=" + XM); await t(500); await p.reload(); await t(4500);
    ok("the team lead's Stack report has Extra production, and no way to pick a file from the computer", (await p.locator(".stk-xbtn").count()) === 1 && !(await p.locator('.main input[type="file"]').count()));
    await pickIt();
    const pv = await p.locator(".overlay .modal").first().innerText();
    ok("OneDrive opens, the file is read, and the preview shows what it would count before anything is saved: 8 rows, 5 to count, 3 left out",
      /Rows read\s*8\b/i.test(pv) && /To count\s*5\b/i.test(pv) && /Left out\s*3\b/i.test(pv) && /Arun Agent/.test(pv) && /Cara Agent/.test(pv) && /1 row with no DOW/.test(pv), pv.slice(0, 600));
    ok("a name from the file is shown as text, never as markup", /<b>Bold<\/b> Sample: 1 row/.test(pv) && (await p.locator(".overlay .xp-names b").count()) === 0, pv.slice(-500));
    ok("nothing is saved by the preview", (await rpc("team.status", { from: DOW, to: DOW })).rows.every((x) => !x.extra));
    await p.locator('.overlay button:has-text("Count 5 rows")').first().click(); await t(4000);
    const lst = await p.locator(".stk-extra").first().innerText();
    ok("counted: the month's files list it, with Remove", lst.includes(NAME) && /Tina Lead/.test(lst) && (await p.locator('.stk-extra button:has-text("Remove")').count()) === 1, lst);
    const ts = await rpc("team.status", { from: DOW, to: DOW });
    ok("the work reaches Team status on its DOW: Arun 3, Cara 2", ts.rows.find((x) => x.name === "Arun Agent").extra === 3 && ts.rows.find((x) => x.name === "Cara Agent").extra === 2, ts.rows.map((x) => [x.name, x.extra]));
    ok("and the Stack report's Productivity shows its extra part", /incl\. 3 extra/.test(await p.locator('.main table.stk-t tr:has-text("Arun Agent")').first().innerText()), await p.locator('.main table.stk-t tr:has-text("Arun Agent")').first().innerText());
    await pickIt();
    ok("the same OneDrive file again says it replaces what it counted, never adds", /This file was counted before/.test(await p.locator(".overlay .modal").first().innerText()));
    await p.locator('.overlay button:has-text("Cancel")').first().click(); await t(600);
    await p.locator('.dash-subtabs button:has-text("Team status")').first().click(); await t(3000);
    await p.locator('.drange button:has-text("Custom")').first().click(); await t(500);
    await p.locator(".drange-c input").nth(0).fill(DOW); await p.locator(".drange-c input").nth(1).fill(DOW); await t(3000);
    const tsRow = await p.locator('.main table.ts tr:has-text("Arun Agent")').first().innerText();
    ok("Team status shows the extra part beside the claims (N claims + 3 extra)", /claims? \+ 3 extra/.test(tsRow), tsRow);
    await open("#/dashboard?tab=stack&month=" + XM); await t(500); await p.reload(); await t(4500);
    await p.locator('.stk-extra button:has-text("Remove")').first().click(); await t(800);
    await p.locator('.overlay .modal button.danger:has-text("Remove")').first().click(); await t(3500);
    ok("Remove takes the file's counts off", /No extra production file is counted/.test(await p.locator(".stk-extra").first().innerText()) && (await rpc("team.status", { from: DOW, to: DOW })).rows.every((x) => !x.extra));
    const au = await p.evaluate(async () => (await (await getLocalBackend()).env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'stack.extra%' ORDER BY at").all()).results.map((x) => x.action));
    ok("the upload and the removal are in the audit trail", au.join() === "stack.extra,stack.extraRemove", au);
  });

  ok("no script errors on any page", !errs.length, errs);
  await b.close(); srv.close();
  const failed = results.filter((x) => !x.pass);
  console.log(`\nworkflows: ${results.length - failed.length} passed, ${failed.length} failed`);
  for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
