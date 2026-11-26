const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const OUT = process.env.SHOTS_DIR ?? 'test';
require('fs').mkdirSync(OUT, { recursive: true });
const ID = process.env.OPPORTUNITY_ID; // an opportunity in prospecting
const EMAIL = process.env.EMAIL ?? 'admin@admin.com'; // the administrator may press every move
const PASSWORD = process.env.PASSWORD ?? 'admin123';
let n = 0;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT + '/video', size: { width: 1600, height: 1000 } } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
  p.on('response', async r => { if (r.url().includes('/transition')) console.log('  press →', r.status(), r.status() >= 300 ? (await r.text()).slice(0, 300) : ''); });
  const shot = async (what) => { await p.waitForTimeout(800); const f = `${OUT}/${String(++n).padStart(2, '0')}-${what}.png`; await p.screenshot({ path: f, fullPage: true }); console.log('shot', f); };
  const where = async () => (await p.locator('[data-testid=record-lifecycle]').first().textContent().catch(() => '?'))?.trim();
  // A cold dev server can submit the sign-in form before it hydrates: retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    await p.goto(BASE + '/auth/login', { timeout: 300000, waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
    await p.fill('input[type=email]', EMAIL); await p.fill('input[type=password]', PASSWORD);
    await p.click('button[type=submit]');
    try { await p.waitForURL(u => !u.pathname.startsWith('/auth/login'), { timeout: 30000 }); break; } catch {}
  }
  await p.goto(`${BASE}/opportunity/${ID}`); await p.locator('[data-testid=record-lifecycle]').first().waitFor({ timeout: 120000 });
  console.log('start →', await where()); await shot('at-prospecting');
  // Press each move the way a person does: a single next status is a button, several are a menu.
  const press = async (event) => {
    const button = p.locator(`[data-testid=record-action-${event}]`);
    if (!(await button.isVisible().catch(() => false))) await p.locator('[data-testid=record-actions-menu]').click();
    await p.locator(`[data-testid=record-action-${event}]`).click();
    await p.waitForTimeout(2500);
    console.log(event, '→', await where()); await shot(event);
  };
  for (const event of ['qualify', 'discover', 'send_proposal', 'negotiate', 'close_won']) await press(event);
  // A won deal is Final and locked: Edit is disabled until someone allowed to reopens it.
  console.log('edit disabled:', await p.getByRole('button', { name: 'Edit' }).first().isDisabled());
  await ctx.close(); await b.close();
})();
