const { chromium } = require('playwright');
const key=process.argv[2]; const S=(process.env.QA_OUT||'./qa-out')+'/'+key+'/';
require('fs').mkdirSync(S,{recursive:true});
(async()=>{
 const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1440,height:900}}); const q=await c.newPage();
 const res={};
 await q.goto('http://localhost:3100/'); await q.waitForTimeout(3000);
 await q.locator('input[type=email]').first().fill('admin@admin.com');
 await q.locator('input[type=password]').first().fill('admin'); await q.getByRole('button',{name:/sign in|log in/i}).first().click(); await q.waitForTimeout(5000);
 await q.screenshot({path:S+'1-report-home.png'});
 res.home=(await q.locator('main, body').first().innerText()).replace(/\s+/g,' ').slice(0,160);
 const open=async(nav,idx)=>{await q.getByRole('link',{name:nav,exact:true}).first().click(); await q.waitForTimeout(3500);
   if(idx>=await q.locator('tbody tr').count()) return null; const row=q.locator('tbody tr').nth(idx); const name=(await row.innerText()).split('\t')[0];
   await row.getByRole('button').last().click(); await q.waitForTimeout(500); await q.getByRole('menuitem',{name:'View'}).click(); await q.waitForTimeout(9000); return name;};
 res.dashboard=await open('Dashboards',0); await q.screenshot({path:S+'2-dashboard.png'});
 res.report=await open('Reports',0); await q.screenshot({path:S+'3-report.png'});
 res.chart=await open('Charts',0); await q.screenshot({path:S+'4-chart.png'});
 for (let i=1;i<25;i++){ const nm=await open('Charts',i); if(nm===null) break; const t=(await q.locator('body').innerText()).match(/Type:\s*(\w+)/); const ty=t?t[1]:'?';
   if(ty==='pie'||ty==='line'){ await q.screenshot({path:S+'5-chart-'+ty+'.png'}); res['chart_'+ty]=nm; if(res.chart_pie&&res.chart_line) break; } }
 const p=await c.newPage(); await p.goto('http://localhost:4000/auth/login'); await p.waitForTimeout(2500);
 await p.locator('input[type=email]').first().fill('admin@admin.com'); await p.locator('input[type=password]').first().fill('admin123'); await p.keyboard.press('Enter'); await p.waitForTimeout(4500);
 await p.screenshot({path:S+'6-app-dashboard.png'});
 const first=p.locator('nav a, aside a').filter({hasNotText:/Dashboard|Automations/}).first(); res.appEntity=(await first.innerText().catch(()=>'?')); await first.click().catch(()=>{}); await p.waitForTimeout(4000);
 await p.screenshot({path:S+'7-app-list.png'});
 console.log(JSON.stringify(res)); await b.close();
})().catch(e=>{console.error('SHOTFAIL',e.message);process.exit(1)});
