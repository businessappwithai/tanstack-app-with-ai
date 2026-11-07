const { chromium } = require('playwright');
const keys = (process.argv[2]||'crm').split(',');
(async()=>{
 const b = await chromium.launch();
 for (const k of keys) {
  const ctx = await b.newContext({acceptDownloads:true, viewport:{width:1440,height:900}});
  const p = await ctx.newPage();
  p.on('pageerror', e=>console.log(k,'pageerror',e.message));
  await p.goto(`${process.env.SITE||'http://localhost:8080'}/guide/run-in-browser.html#${k}`);
  await p.waitForSelector('#generate');
  await p.click('#generate');
  await p.waitForFunction(()=>!document.querySelector('#download-stack').disabled,{timeout:300000});
  const [d] = await Promise.all([p.waitForEvent('download',{timeout:300000}), p.click('#download-stack')]);
  await d.saveAs(`${process.env.QA_DIR||'/tmp/qa'}/zips/${k}.zip`);
  console.log(k,'ok',d.suggestedFilename());
  await ctx.close();
 }
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
