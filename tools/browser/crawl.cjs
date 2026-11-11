/* Browser check: every page for every kind of user (admin, AR team lead, manager, biller, posting, submission and
   their leads), in each theme. Fails when a page shows a script error or an error box, or a menu item opens the
   wrong page.   node tools/browser/crawl.cjs        (THEMES=light,navy,gold for more themes) */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { REPO, prepareDemo, serve, routeCdn } = require("./demo.cjs");
const OUT = path.join(REPO, "tools", "test-results", "crawl"); fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS === "1";
const P = (o) => Object.assign({ emp_id: '', name: '', position: 'Agent', function: 'Operations', department: 'AR', also_in_departments: '', status: 'Working', project: 'Sunrise Eye Care', also_on_projects: '', reports_to: 'Tina Lead', shift: '18:30-03:30', location: 'Pune', doj: '2026-03-01', exit_date: null, email: '' }, o);
const FEED = [P({ emp_id: 'E1', name: 'Tina Lead', position: 'Team Lead', reports_to: 'Mo Manager', email: 'tina@purview-healthcare.com' }), P({ emp_id: 'E2', name: 'Arun Agent', email: 'arun@purview-healthcare.com' }),
  P({ emp_id: 'E4', name: 'Snail Post', department: 'Posting', reports_to: 'Paula PostLead', email: 'snail@purview-healthcare.com' }), P({ emp_id: 'E5', name: 'Mark Sub', department: 'Submission', reports_to: 'Sam SubLead', email: 'mark@purview-healthcare.com' }),
  P({ emp_id: 'E6', name: 'Paula PostLead', position: 'Team Lead', department: 'Posting', reports_to: 'Mo Manager', email: 'paula@purview-healthcare.com' }), P({ emp_id: 'E12', name: 'Sam SubLead', position: 'Team Lead', department: 'Submission', reports_to: 'Mo Manager', email: 'sam@purview-healthcare.com' }),
  P({ emp_id: 'E10', name: 'Mo Manager', position: 'Manager', department: 'All', project: '', reports_to: '', email: 'mo@purview-healthcare.com' })];
const ROLES = [['admin', null], ['ar-lead', 'tina@purview-healthcare.com'], ['manager', 'mo@purview-healthcare.com'], ['biller', 'arun@purview-healthcare.com'], ['posting', 'snail@purview-healthcare.com'], ['submission', 'mark@purview-healthcare.com'], ['posting-lead', 'paula@purview-healthcare.com'], ['submission-lead', 'sam@purview-healthcare.com']];
const THEMES = (process.env.THEMES || 'light').split(',');
(async () => {
  const PORT = Number(process.env.BROWSER_PORT) || 8766; // BROWSER_PORT lets two copies of the repo run their checks at once
  const srv = await serve(PORT);
  const url = prepareDemo({ base: "http://localhost:" + PORT });
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}); const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  await routeCdn(p);
  await p.route('https://qhbgshnqugxqiwdywsas.supabase.co/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, rows: FEED }) }));
  await p.route(/brahmastra_live/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'not set up' }) }));
  let errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts|net::ERR|brahmastra-api ApiError/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  const issues = []; const t = (ms) => p.waitForTimeout(ms);
  const clearModals = async () => { for (let k = 0; k < 4; k++) { const ov = p.locator('.overlay'); if (!(await ov.count())) break; const btn = p.locator('.overlay button:has-text("Later"), .overlay button:has-text("Skip for now"), .overlay button:has-text("Close"), .overlay button:has-text("Cancel")').first(); if (await btn.count()) { await btn.click().catch(() => {}); await t(700); } else break; } };
  const note = (role, where) => { const alerts = []; return p.$$eval('.alert.err', (els) => els.map((e) => e.innerText.slice(0, 160))).then((a) => { a.forEach((x) => alerts.push(x)); if (errs.length || alerts.length) issues.push({ role, where, errs: errs.slice(0, 5), alerts }); errs = []; }); };
  await p.goto(url); await t(4000);
  await p.click('button:has-text("Load sample data")'); for (let i = 0; i < 15; i++) { await t(3000); if ((await p.innerText('body')).includes('Dashboard')) break; }
  // roster from the pretend Shastra, then first passwords for everyone
  const tokens = await p.evaluate(async (FEED) => {
    await window.__rpc('roster.syncShastra'); const out = {};
    for (const f of FEED) { const m = (await window.__rpc('auth.lookup', { q: f.name.split(' ')[0] })).matches.find((x) => x.name === f.name); if (!m) { out[f.email] = 'NOT FOUND'; continue; }
      try { await window.__rpc('auth.firstPassword', { user_id: m.id, passHash: await window.__sha('pw-' + f.email) }); } catch (e) {}
      try { out[f.email] = (await window.__rpc('auth.login', { email: f.email, passHash: await window.__sha('pw-' + f.email) })).token; } catch (e) { out[f.email] = 'LOGIN FAILED ' + e.message; } }
    // give the posting / submission people something to work with
    const cl = (await window.__rpc('clients.list')).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)); const us = (await window.__rpc('users.list')).users; const U = (n) => us.find((u) => u.name === n);
    await window.__rpc('clients.saveResponsibility', { client_id: sun.id, dept: 'posting', mode: 'person', lead: U('Snail Post').id, backup: U('Paula PostLead').id });
    await window.__rpc('clients.saveResponsibility', { client_id: sun.id, dept: 'submission', mode: 'person', lead: U('Mark Sub').id, backup: U('Sam SubLead').id });
    return out;
  }, FEED);
  await p.evaluate(() => window.__flush());
  const adminToken = await p.evaluate(() => localStorage.getItem('brahmastra2:token'));
  console.log('TOKENS:', Object.entries(tokens).map(([k, v]) => k.split('@')[0] + ':' + (v.length > 20 ? 'ok' : v)).join(' '));
  for (const theme of THEMES) for (const [role, email] of ROLES) {
    const tok = email ? tokens[email] : adminToken;
    await p.evaluate(([tok, theme]) => { localStorage.setItem('brahmastra2:token', tok); localStorage.setItem('brahmastra:prefs', JSON.stringify({ theme, text: 'normal' })); }, [tok, theme]);
    await p.goto(url + '#/'); await p.reload(); await t(5000); await clearModals(); errs = [];
    if (!(await p.$('.nav'))) { const why = await p.evaluate(async () => { try { await window.__rpc('auth.me'); return 'auth.me ok'; } catch (e) { return 'auth.me failed: ' + e.message; } }); console.log('  ' + role + ' not signed in: ' + why + ' · token ' + String(tok).slice(0, 12)); }
    const tops = p.locator('.nav > button, .nav > .nav-group > button');
    const nTop = await tops.count();
    const tabs = []; for (let i = 0; i < nTop; i++) tabs.push((await tops.nth(i).innerText()).replace(/\d+$/, '').trim());
    console.log(`[${theme}] ${role}: ${tabs.join(' | ')}`);
    await note(role, 'landing'); if (SHOTS) await p.screenshot({ path: `${OUT}/${theme}-${role}-0-landing.png` });
    const perTab = async (label, i, j) => {
      await note(role, label); if (SHOTS && theme === 'light') await p.screenshot({ path: `${OUT}/${theme}-${role}-${i + 1}${j != null ? '-' + j : ''}-${label.replace(/[^a-z]+/gi, '_')}.png`, fullPage: false });
      // inside My day & reports: every page of the side menu, and each date preset
      if (/reports/i.test(label)) {
        const items = await p.$$eval('.rh-it', (x) => x.map((e) => e.querySelector('.t').innerText));
        for (let j = 0; j < items.length; j++) { await p.locator('.rh-it').nth(j).click(); await t(2500); await note(role, 'reports/' + items[j]); }
        for (const k of ['This week', 'This month', 'Custom', 'Today']) { const btn = p.locator('.drange button:has-text("' + k + '")').first(); if (await btn.count()) { await btn.click(); await t(1200); await note(role, 'reports date ' + k); } }
      }
      if (/^Claims$/.test(label)) { const row = p.locator('table.t tbody tr.click').first(); if (await row.count()) { await row.click(); await t(2200); await note(role, 'claim drawer'); if (SHOTS && theme === 'light') await p.screenshot({ path: `${OUT}/${theme}-${role}-claim-drawer.png` }); await p.keyboard.press('Escape'); await t(500); const x = p.locator('button:has-text("Close")').first(); if (await x.count()) await x.click().catch(() => {}); } }
      if (/^Dashboard$/.test(label)) for (const k of ['Today', 'This week', 'Custom', 'All time']) { const btn = p.locator('.drange button:has-text("' + k + '")').first(); if (await btn.count()) { await btn.click(); await t(1500); await note(role, 'dashboard date ' + k); } }
    };
    for (let i = 0; i < nTop; i++) {
      await clearModals(); await tops.nth(i).click({ timeout: 8000 }).catch(() => {}); await t(700);
      const m = await p.locator('.nav .menu button').count();
      if (m) {
        const items = []; for (let j = 0; j < m; j++) items.push((await p.locator('.nav .menu button').nth(j).innerText()).replace(/\d+$/, '').trim());
        console.log(`  [${theme}] ${role} ${tabs[i]} > ${items.join(' · ')}`);
        for (let j = 0; j < items.length; j++) {
          if (!(await p.locator('.nav .menu button').count())) { await tops.nth(i).click().catch(() => {}); await t(400); }
          await p.locator('.nav .menu button').nth(j).click({ timeout: 8000 }).catch(() => {}); await t(2600); await clearModals();
          const h1 = await p.locator('.main h1').first().innerText().catch(() => '');
          if (/^Dashboard$/.test(h1)) issues.push({ role, where: tabs[i] + ' > ' + items[j], alerts: ['opened the Dashboard instead of ' + items[j]] });
          await perTab(items[j], i, j);
        }
      } else { await t(1900); await clearModals(); await perTab(tabs[i], i); }
    }
    await p.evaluate(() => { location.hash = '#/settings'; }); await t(2000); await note(role, 'settings');
    if (SHOTS && theme === 'light') await p.screenshot({ path: `${OUT}/${theme}-${role}-settings.png`, fullPage: true });
    await p.click('.topbar .btn.sm').catch(() => {}); await t(500);
    const menu = await p.innerText('.menu').catch(() => ''); if (/Change password/.test(menu)) issues.push({ role, where: 'menu', alerts: ['Change password still in menu'] });
  }
  console.log('\nISSUES: ' + issues.length); for (const x of issues) console.log(JSON.stringify(x));
  await b.close(); srv.close();
})();
