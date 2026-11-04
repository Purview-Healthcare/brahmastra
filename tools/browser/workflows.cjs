/* Browser check of the workflows people do through the screens (the API checks cover the server side):
   inventory upload from a file, allocation, a biller's work entry, the claims and reports CSV, the dashboard
   filter, the theme, month-end, answering an escalation, the posting desk, feedback, TFL / AFL, a new client.
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
  const srv = await serve(8768);
  const url = prepareDemo({ base: "http://localhost:8768" });
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
    const act = note.locator(".field:has-text(\"Action\")").last();
    await pick(act, "corrected & resubmitted");
    const preview = await p.locator("text=NOTE PREVIEW").locator("xpath=..").innerText().catch(() => "");
    ok("the note preview builds the one-cell note", /SAAG: Claim Not On File > Policy Active > Need to Resubmit/.test(await p.innerText(".main")), preview.slice(0, 200));
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

  S("Dashboard");
  await step("dashboard", async () => {
    // Live status: its own tab, right after Sasha's Third Eye
    await open("#/live"); await t(2500);
    ok("Live status shows the floor", (await p.locator(".dash-team").count()) === 1 && /On the floor now/i.test(await p.locator(".dash-team").innerText()));
    ok("no error on Live status", !(await p.locator(".alert.err").count()));
    ok("a team lead has no team lead filter", !/team lead/i.test(await p.locator(".dash-filters").innerText()));
    // Dashboard: Team status, Inventory status, Client 360 report
    await open("#/dashboard"); await t(2500);
    ok("Dashboard opens on Team status", /Team status by team lead/i.test(await p.innerText(".main")));
    ok("Team status has the suggestions", /Suggestions/i.test(await p.innerText(".main")) && /Do today/i.test(await p.innerText(".main")));
    ok("the Dashboard has three tabs: Team status, Inventory status, Client 360 report", (await p.locator(".dash-subtabs button").allInnerTexts()).map((x) => x.trim()).join("|") === "Team status|Inventory status|Client 360 report", await p.locator(".dash-subtabs button").allInnerTexts());
    await p.locator('.dash-subtabs button:has-text("Inventory status")').click(); await t(3500);
    ok("Inventory status is the client list: Drishti's score and the claims in detail", /Workable AR/i.test(await p.innerText(".main")) && /SLA score/i.test(await p.innerText(".main")) && /Claims in detail/i.test(await p.innerText(".main")) && (await p.locator(".psla-score").count()) > 0, (await p.innerText(".main")).slice(0, 200));
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

  S("SLA tab: the scorecard in Client 360's style, the Monday digest");
  await step("scorecard", async () => {
    await as("tina"); await open("#/sla"); await t(3000);
    await p.locator('.ws-tabs button:has-text("SLA scorecard")').click(); await t(3500);
    const txt = await p.innerText(".main");
    ok("the only client opens by itself: the score dial, the band and the counts", (await p.locator(".psla-dial").count()) === 1 && /green/.test(txt) && /red/.test(txt) && /October 2026/.test(txt), txt.slice(0, 300));
    ok("the scopes, what pulls it down and the strengths", (await p.locator(".psla-sc").count()) >= 3 && /What pulls it down/i.test(txt) && /AR Aging/.test(txt) && /Strengths/i.test(txt), { n: await p.locator(".psla-sc").count() });
    ok("every KPI with its formula", /Formula/i.test(txt) && /Balance in >90-day buckets/.test(txt) && (await p.locator(".psla-kpis tbody tr").count()) >= 10, { n: await p.locator(".psla-kpis tbody tr").count() });
    ok("the score by month and where the figures come from", /Score by month/i.test(txt) && /AR Inventory report/.test(txt));
    const c = await dl(() => p.locator('.main button:has-text("CSV")').first().click());
    ok("the KPI CSV carries the formula column", /Scope,KPI,Value,Standard,Formula,Status,From,Comment/.test(fs.readFileSync(c, "utf8").split("\n")[0]));
    await p.locator('.main button:has-text("Upload this period")').click(); await t(1500);
    ok("Upload this period's reports goes back to Drishti's own page, the scorecard tab off", !/on/.test(await p.locator('.ws-tabs button:has-text("SLA scorecard")').getAttribute("class")) && (await p.locator(".rh-frame-body:not([hidden])").count()) === 1 && !(await p.locator(".psla-dial").count()));
    await p.locator('.ws-tabs button:has-text("Monday digest")').click(); await t(2500);
    ok("Monday digest is a tab of the SLA tab", /Monday digest email/.test(await p.innerText(".main")) && (await p.locator(".rh-frame-body:not([hidden])").count()) === 0);
    await open("#/dashboard"); await t(2000); await p.locator('.dash-subtabs button:has-text("Inventory status")').click(); await t(3000);
    await p.locator('.main button:has-text("scorecard ›")').first().click(); await t(2500);
    ok("scorecard › on an Inventory status row opens that client's scorecard on the SLA tab", /#\/sla/.test(p.url()) && /on/.test(await p.locator('.ws-tabs button:has-text("SLA scorecard")').getAttribute("class")) && (await p.locator(".psla-dial").count()) === 1, { url: p.url() });
  });

  S("Needs attention: answer an escalation");
  await step("escalation", async () => {
    await as("arun");
    const q = await rpc("queue.next", {}); const c = q.claim;
    await rpc("queue.complete", { id: c.id, saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Need the TL to confirm the next step", action: "follow up" }, escalate: true });
    await as("tina");
    await open("#/attention"); await t(1500);
    ok("the escalation is listed", (await p.innerText(".main")).includes(c.claim_no));
    await p.locator(`.main tr:has-text("${c.claim_no}") button:has-text("Answer"), .main button:has-text("Answer")`).first().click(); await t(800);
    await p.locator(".overlay textarea").first().fill("Call the payer again and ask for the reprocessing reference.");
    await p.locator(".overlay button.btn.primary").first().click(); await t(2000);
    const still = (await rpc("attention.list", {})).rows.some((x) => x.id === c.id);
    ok("answering clears it", !still);
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
    await m.locator('button.btn.primary').first().click(); await t(2000);
    const cl = (await rpc("claims.get", { id: c.id })).claim;
    ok("Completed with proof closes the claim as Payment posted", /posted|closed|resolved/i.test(cl.state + " " + (cl.state_reason || "") + " " + (cl.handoff_status || "")), [cl.state, cl.state_reason, cl.handoff_status]);
    await open("#/clients"); await t(1500);
    ok("Snail sees the client he posts for in My clients", /Sunrise Eye Care/.test(await p.innerText(".main")) && /you are responsible here/.test(await p.innerText(".main")));
    ok("with no edit buttons", !(await p.locator('.main button:has-text("Edit profile")').count()));
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

  ok("no script errors on any page", !errs.length, errs);
  await b.close(); srv.close();
  const failed = results.filter((x) => !x.pass);
  console.log(`\nworkflows: ${results.length - failed.length} passed, ${failed.length} failed`);
  for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
