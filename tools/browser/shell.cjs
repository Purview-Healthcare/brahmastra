/* Browser check of the parts every page shares: Ctrl+K search, the bell, the phone layout (no page wider than a
   phone) and signing out after a quiet spell (shortened to a few seconds here).   node tools/browser/shell.cjs */
const { chromium } = require("playwright");
const { prepareDemo, serve, routeCdn } = require("./demo.cjs");
(async () => {
  const PORT = Number(process.env.BROWSER_PORT) || 8767; // BROWSER_PORT lets two copies of the repo run their checks at once
  const srv = await serve(PORT);
  const url = prepareDemo({ base: "http://localhost:" + PORT });
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  await routeCdn(p);
  await p.addInitScript(() => { window.BRAHMASTRA_IDLE_MIN = 0.15; });   // 9 seconds, the warning in the last 4.5
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const t = (ms) => p.waitForTimeout(ms);
  const results = []; const ok = (name, cond, info) => { results.push(!!cond); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + JSON.stringify(info).slice(0, 300))); };
  await p.goto(url); await t(3000);
  await p.click('button:has-text("Load sample data")'); for (let i = 0; i < 15; i++) { await t(2000); if ((await p.innerText("body")).includes("Dashboard")) break; }
  const busy = setInterval(() => p.mouse.move(100 + Math.random() * 200, 300).catch(() => {}), 1500);   // stay active while checking the rest
  for (let k = 0; k < 4; k++) { const x = p.locator('.overlay button:has-text("Later"), .overlay button:has-text("Skip for now")').first(); if (await x.count()) { await x.click().catch(() => {}); await t(400); } }
  await p.keyboard.press("Control+k"); await t(400);
  ok("Ctrl+K opens the search", await p.locator(".cmdk input").count());
  await p.keyboard.type("dash"); await t(300); await p.keyboard.press("Enter"); await t(1200);
  ok("typing a page name and Enter goes there", /#\/dashboard/.test(p.url()) && !(await p.locator(".cmdk").count()), p.url());
  await p.keyboard.press("Control+k"); await t(300); await p.keyboard.type("77"); await t(1500);
  const n = await p.locator(".cmdk-item").count();
  ok("claims are found by number", n > 0, n);
  await p.keyboard.press("Enter"); await t(2000);
  ok("Enter opens the claim", await p.locator('.overlay .modal').count() && !(await p.locator(".cmdk").count()));
  await p.keyboard.press("Escape"); await p.locator('.overlay button:has-text("Close")').first().click().catch(() => {}); await t(500);
  await p.click('button[aria-label^="Notifications"]'); await t(500);
  ok("the bell opens its list", await p.locator(".bell-menu").count());
  await p.click("body", { position: { x: 30, y: 600 } }); await t(300);
  await p.setViewportSize({ width: 390, height: 844 });
  const wide = [];
  for (const v of ["dashboard", "live", "attention", "teamtoday", "claims", "inventory", "client", "portfolio", "audit", "team", "clients", "raci", "reports", "templates", "settings"]) {
    await p.evaluate((x) => { location.hash = "#/" + x; }, v); await t(1500);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 392) wide.push(v + " " + sw);
  }
  ok("no page is wider than a phone", !wide.length, wide);
  await p.setViewportSize({ width: 1440, height: 950 });
  clearInterval(busy); await t(800);
  await p.waitForSelector(".idle-warn", { timeout: 9000 }).catch(() => {});
  ok("a quiet spell shows the sign-out warning", await p.locator(".idle-warn").count());
  await p.mouse.move(400, 400); await p.mouse.move(420, 410); await t(300);
  ok("moving the mouse keeps the person signed in", !(await p.locator(".idle-warn").count()) && (await p.locator(".topbar").count()));
  await p.waitForSelector(".topbar", { state: "detached", timeout: 15000 }).catch(() => {});
  await p.waitForFunction(() => /without activity/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
  ok("staying quiet signs them out, and says why", (await p.locator(".topbar").count()) === 0 && /without activity/.test(await p.innerText("body")));
  ok("no script errors", !errs.length, errs);
  await b.close(); srv.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\nshell: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
