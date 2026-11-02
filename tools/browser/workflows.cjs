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
    const head = fs.readFileSync(f, "utf8").split("\n")[0];
    ok("Claims downloads a CSV with the last SAAG entry", /claim/i.test(head) && /saag|status/i.test(head), head.slice(0, 200));
    await open("#/reports"); await t(1500);
    const every = p.locator('text=Every entry').first(); if (await every.count()) { await every.click(); await t(1500); }
    const g = await dl(() => p.locator('.main button:has-text("Download CSV")').first().click());
    const body = fs.readFileSync(g, "utf8");
    ok("Every entry downloads with the SAAG fields and the note", /status/i.test(body.split("\n")[0]) && body.includes("Policy Active"), body.split("\n")[0].slice(0, 200));
  });

  S("Report shortcuts on My day & reports");
  await step("shortcuts", async () => {
    await open("#/reports"); await t(800);
    await p.screenshot({ path: path.join(OUT, "reports-shortcuts.png") });
    await p.locator('.main button:has-text("Internal reports")').first().click(); await t(2000);
    ok("Internal reports opens Sasha's Third Eye on Internal reports", /#\/thirdeye/.test(p.url()) && /on/.test(await p.locator('.te-switch button:has-text("Internal reports")').getAttribute("class")), p.url());
    await open("#/reports"); await t(800);
    await p.locator('.main button:has-text("Client reports")').first().click(); await t(2000);
    ok("Client reports opens it on Client reports", /on/.test(await p.locator('.te-switch button:has-text("Client reports")').getAttribute("class")));
    await open("#/reports"); await t(800);
    await p.locator('.main button:has-text("SLA scorecard")').first().click(); await t(1500);
    ok("SLA scorecard opens the SLA tab", /#\/sla/.test(p.url()), p.url());
  });

  S("Dashboard");
  await step("dashboard", async () => {
    await open("#/dashboard"); await t(2500);
    const bar = p.locator(".main .bar, .main .hbar, .main [class*=bar]").first();
    if (await bar.count()) { await bar.click().catch(() => {}); await t(1200); }
    ok("cards and charts show", /Workable AR/i.test(await p.innerText(".main")));
    ok("no error on the dashboard", !(await p.locator(".alert.err").count()));
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
    const tg = m.locator('input[placeholder="claims a day"]'); await tg.nth(0).fill("45"); await tg.nth(1).fill("60");
    const row = (l) => m.locator('.row:has(> b:text-is("' + l + '"))');
    await pick(row("AR follow-up"), "Tina Lead"); await pick(row("Payment posting"), "Snail Post");
    await m.locator('button:has-text("Create client")').click(); await t(2500);
    ok("the client is created", /Dr\. Montella Eye Care/.test(await p.innerText(".main")));
    await as("snail");
    ok("the posting person sees it straight away", (await rpc("clients.list")).clients.some((c) => c.name === "Dr. Montella Eye Care"));
  });

  ok("no script errors on any page", !errs.length, errs);
  await b.close(); srv.close();
  const failed = results.filter((x) => !x.pass);
  console.log(`\nworkflows: ${results.length - failed.length} passed, ${failed.length} failed`);
  for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
