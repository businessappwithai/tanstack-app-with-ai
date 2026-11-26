const { chromium } = require('playwright'); const fs=require('fs'); const glob=require('child_process');
const key=process.argv[2]; const S=(process.env.QA_OUT||'./qa-out')+'/'+key+'/';
const readme=glob.execSync(`cat ${process.env.QA_DIR||'/tmp/qa'}/run/${key}/*/reporting/README.md`).toString();
const rows=[...readme.matchAll(/^\| `([^`]+)` \| `[^`]+` \| `([^`]+@[^`]+)` \| (\d+) of (\d+)/gm)].map(m=>({role:m[1],email:m[2],n:+m[3],of:+m[4]}));
const pick=rows.filter(r=>r.n>0&&r.n<r.of&&!/^admin/i.test(r.email)).sort((a,b)=>a.n-b.n)[0] || rows.find(r=>r.n===0&&/^user@/.test(r.email)); 
(async()=>{
 if(!pick){console.log(JSON.stringify({rolecheck:'no narrow role found',rows:rows.length}));return;}
 const b=await chromium.launch(); const q=await (await b.newContext({viewport:{width:1440,height:900}})).newPage(); const r={role:pick.role,tables:pick.n+' of '+pick.of};
 await q.goto('http://localhost:3100/'); await q.waitForTimeout(3000);
 await q.locator('input[type=email]').first().fill(pick.email); await q.locator('input[type=password]').first().fill('admin'); await q.getByRole('button',{name:/sign in|log in/i}).first().click(); await q.waitForTimeout(5500);
 r.url=q.url(); r.sidebar=(await q.getByRole('link').allInnerTexts()).filter(Boolean).join(', ').slice(0,200); r.administration=/Administration/i.test(await q.locator('body').innerText());
 await q.screenshot({path:S+'8-role-home.png'});
 await q.getByRole('link',{name:'Reports',exact:true}).first().click().catch(()=>{}); await q.waitForTimeout(3500);
 r.reportRows=await q.locator('tbody tr').count();
 if(r.reportRows){ r.permitted=0; r.refused=0; r.empty=0;
  for(let i=0;i<Math.min(r.reportRows,12);i++){
   await q.getByRole('link',{name:'Reports',exact:true}).first().click(); await q.waitForTimeout(2500);
   const row=q.locator('tbody tr').nth(i); await row.getByRole('button').last().click(); await q.waitForTimeout(400); await q.getByRole('menuitem',{name:'View'}).click(); await q.waitForTimeout(6000);
   const alertEl=q.locator('[data-testid=report-data-error]').first();
   if(await alertEl.count()){ r.refused++; if(!r.refusalAlert){ r.refusalAlert=(await alertEl.innerText()).replace(/\s+/g,' ').slice(0,200); r.refusedReport=(await q.locator('h1,h2').first().innerText().catch(()=>'')).slice(0,70); await q.screenshot({path:S+'9-role-refusal.png'}); } }
   else { const txt=await q.locator('body').innerText(); if(/Showing 1 to 0 of 0|No results/i.test(txt)){ r.empty++; if(!r.emptyShot){ r.emptyShot=1; await q.screenshot({path:S+'9-role-empty.png'}); } } else { r.permitted++; if(!r.permittedShot){ r.permittedShot=1; await q.screenshot({path:S+'9-role-report.png'}); } } }
  }
 }
 console.log(JSON.stringify(r)); await b.close();
})().catch(e=>{console.error('ROLEFAIL',e.message);process.exit(1)});
