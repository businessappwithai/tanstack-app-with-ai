const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const OUT = process.env.SHOTS_DIR ?? 'build';
require('fs').mkdirSync(OUT, { recursive: true });
let n = 0;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT + '/video', size: { width: 1600, height: 1000 } } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
  const aside = () => p.locator('aside').last();
  const field = (label) => aside().locator('label').filter({ hasText: label }).first().locator('select, input, textarea').first();
  const set = async (label, value) => {
    const el = field(label); const tag = await el.evaluate(e => e.tagName);
    if (tag === 'SELECT') {
      // The editor fills some lists after another choice (a record type's fields): wait for the option.
      await p.waitForFunction(([sel, v]) => [...sel.options].some(o => o.textContent.trim() === v || o.value === v), [await el.elementHandle(), value], { timeout: 15000 });
      await el.selectOption({ label: value }).catch(() => el.selectOption(value));
      const chosen = await el.evaluate(s => s.options[s.selectedIndex]?.textContent.trim());
      if (chosen !== value && (await el.inputValue()) !== value) throw new Error(`${label}: wanted ${value}, got ${chosen}`);
    } else await el.fill(value);
    await p.waitForTimeout(300);
  };
  const shot = async (what) => {
    await p.waitForTimeout(600);
    await p.evaluate(() => {
      window.scrollTo(0, 0);
      const ladder = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 4 && /overflow-y-auto/.test(d.className) && d.textContent.includes('When this happens'));
      if (ladder) ladder.scrollTop = ladder.scrollHeight;
      for (const el of document.querySelectorAll('main, main *')) if (el !== ladder && el.scrollTop > 0 && !el.closest('aside')) el.scrollTop = 0;
    });
    await p.waitForTimeout(300);
    const file = `${OUT}/${String(++n).padStart(2, '0')}-${what}.png`;
    await p.screenshot({ path: file, fullPage: true });
    const fix = await p.evaluate(() => (document.body.innerText.match(/\d+ things? to fix before publishing/) || ['ready'])[0]);
    let detail = '';
    if (fix !== 'ready') detail = JSON.stringify(await p.evaluate(() => [...new Set([...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /is missing|needs a|must |has no|Give up|without a|No steps|Add at least/i.test(e.textContent) && e.textContent.length < 200).map(e => e.textContent.trim()))]));
    console.log('shot', file, '|', fix, detail);
  };
  const add = async (kind, inside = false) => {
    const adder = inside ? p.getByRole('button', { name: /Add a step inside this repeat/ }).last()
                         : p.getByRole('button', { name: /^＋ Add a condition or an action$/ }).last();
    await adder.scrollIntoViewIfNeeded(); await adder.click(); await p.waitForTimeout(500);
    await p.getByRole('menuitem', { name: new RegExp('^\\S*\\s*' + kind) }).first().click(); await p.waitForTimeout(700);
  };

  await p.goto(BASE + '/auth/login', { timeout: 180000 }); await p.waitForSelector('input[type=password]', { timeout: 180000 });
  await p.fill('input[type=email]', 'admin@admin.com'); await p.fill('input[type=password]', 'admin123');
  await p.click('button[type=submit]'); await p.waitForURL(u => !u.pathname.startsWith('/auth/login'), { timeout: 120000 });
  await p.goto(BASE + '/admin/automations'); await p.getByText('Rules and workflows', { exact: true }).waitFor({ timeout: 120000 }); await p.waitForTimeout(4000);
  const old = p.getByRole('button', { name: 'Delete DealCloseOutPlaybook' });
  if (await old.count()) {
    await p.getByRole('button', { name: /Deal Close-Out Playbook/ }).first().hover(); await old.first().click({ force: true }); await p.waitForTimeout(800);
    const confirm = p.getByRole('button', { name: /^(Delete|Confirm|Yes)/ }); if (await confirm.count()) await confirm.last().click().catch(() => {});
    await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(2500);
    console.log('removed the earlier copy:', (await p.getByRole('button', { name: /Deal Close-Out Playbook/ }).count()) === 0);
  }
  await shot('rules-and-workflows');

  // 1. a new process
  await p.getByRole('button', { name: 'process', exact: true }).click(); await p.waitForTimeout(1500);
  await shot('new-process');
  await p.locator('input[aria-label="Name"]').fill('Deal Close-Out Playbook'); await p.waitForTimeout(300);
  await shot('named');

  // 2. the trigger
  await p.getByText('When this happens', { exact: false }).first().click().catch(() => {});
  await set('Record type', 'Opportunity');
  await set('What starts it', "The record's own lifecycle");
  await set('On which write', 'Updated');
  await shot('trigger-opportunity-updated');

  // 3. a check
  await add('A check');
  await set('Field to look at', 'opportunity.stage'); await set('Test', 'is'); await set('Value', 'closed_won');
  await shot('check-stage-is-closed-won');

  // 4. a rule table
  await add('Look up a rule table');
  await set('Rule table', 'opportunityForecast'); await set('Save the answer as', 'forecastAnswer');
  await shot('decision-opportunityForecast');

  // 5-10. every formula operation
  const formula = async (op, from, and, as) => {
    await add('Work out a value');
    await set('Operation', op); await set('Value to work from', from);
    if (and !== null) await set('And this value', and);
    await set('Save the answer as', as);
    await shot(`formula-${op}-${as}`);
  };
  await formula('set', '0.05', null, 'commissionRate');
  await formula('copy', '{{amount}}', null, 'dealAmount');
  await formula('multiply', '{{amount}}', '{{commissionRate}}', 'commission');
  await formula('divide', '{{amount}}', '12', 'monthlyRunRate');
  await formula('add', '{{amount}}', '500', 'amountWithFees');
  await formula('subtract', '{{amount}}', '{{commission}}', 'netRevenue');

  // 11. create a draft checklist, then the review task
  await add('Create a record');
  await set('Record type', 'Activity');
  await set('Columns to set', 'activity_type: task\nsubject: Draft close-out checklist\nstatus: planned\npriority: low\nopportunity_id: {{opportunity.id}}\nowner_id: {{opportunity.owner_id}}');
  await set('Save the answer as', 'draftChecklistId');
  await shot('create-draft-checklist');
  await add('Create a record');
  await set('Record type', 'Activity');
  await set('Columns to set', 'activity_type: task\nsubject: Close-out review\nstatus: planned\npriority: high\nopportunity_id: {{opportunity.id}}\naccount_id: {{opportunity.account_id}}\nowner_id: {{opportunity.owner_id}}\ndescription: Commission {{commission}}, net {{netRevenue}}');
  await set('Save the answer as', 'closeoutTaskId');
  await shot('create-closeout-review');

  // 12. update this opportunity
  await add('Update a field');
  await set('Record type', 'Opportunity'); await set('Which record', '{{opportunity.id}}');
  await set('Field to write', 'next_step'); await set('New value', 'Close-out review booked');
  await shot('update-next-step');

  // 13. a repeat, with a step inside it
  await add('A repeat');
  await set('Field to look at', 'opportunity.probability'); await set('Keep going while', 'is less than');
  await set('Value', '100'); await set('Give up after', '3');
  await shot('repeat-while-probability-below-100');
  // The repeat brings a placeholder step of its own; open it and fill it in.
  await p.getByText('Set a field to …').last().click(); await p.waitForTimeout(700);
  await set('Record type', 'Opportunity'); await set('Which record', '{{opportunity.id}}');
  await set('Field to write', 'probability'); await set('New value', '100');
  await shot('inside-repeat-update-probability');

  // 14. delete the draft
  await add('Delete a record');
  await set('Record type', 'Activity'); await set('Which record', '{{draftChecklistId}}');
  await shot('delete-draft-checklist');

  // 15. call a web service
  await add('Call a web service');
  await set('Method', 'POST'); await set('URL', 'http://127.0.0.1:4999/crm/closed-won');
  await set('Body', '{"opportunity":"{{opportunity.id}}","amount":"{{amount}}","commission":"{{commission}}","monthlyRunRate":"{{monthlyRunRate}}","netRevenue":"{{netRevenue}}","reviewTask":"{{closeoutTaskId}}"}');
  await set('Save the answer as', 'webhookResponse');
  await shot('rest-post-webhook');

  // 16. save, reload, reopen
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(3000);
  await shot('saved');
  const toasts = await p.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent.trim()));
  console.log('TOASTS', JSON.stringify(toasts));
  await p.reload(); await p.getByText('Rules and workflows', { exact: true }).waitFor({ timeout: 120000 }); await p.waitForTimeout(4000);
  await p.getByRole('button', { name: /Deal Close-Out Playbook/ }).first().click(); await p.waitForTimeout(2000);
  await shot('reloaded-and-reopened');
  const eml = p.getByRole('button', { name: /Show EML/ }); if (await eml.count()) { await eml.first().click(); await p.waitForTimeout(1500); }
  await p.evaluate(() => { const pre = [...document.querySelectorAll('pre, code, textarea')].find(e => /%%workflow|%%step/.test(e.textContent || e.value || '')); if (pre) pre.scrollIntoView({ block: 'start' }); });
  await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${String(++n).padStart(2,'0')}-eml.png` }); console.log('shot eml');
  console.log('EML', await p.evaluate(() => { const pre = [...document.querySelectorAll('pre, code, textarea')].find(e => /%%workflow|%%step/.test(e.textContent || e.value || '')); return pre ? (pre.textContent || pre.value).slice(0, 4000) : 'no EML found'; }));
  await ctx.close(); await b.close();
})();
