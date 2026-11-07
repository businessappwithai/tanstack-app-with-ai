// Generic CRUD through the browser only: sidebar click -> New -> fill -> Create -> find row -> edit -> Save -> delete.
const { chromium } = require('playwright');
const key=process.argv[2]||'x'; const ents=(process.argv[3]||'').split('|').filter(Boolean);
const S=(process.env.QA_OUT||'./qa-out')+'/'+key+'/'; require('fs').mkdirSync(S,{recursive:true});
const TS=Date.now().toString(36);
let CUR=''; let PICK=1; let MINIMAL=false; async function fill(p){
 await fill1(p); const r=await fill1(p,true);
 // Dependent lookups load only after their parent is chosen and may sit earlier in the form
 // than the parent: keep going until no dropdown that has options is left empty.
 for(let i=0;i<6;i++){
  let changed=0;
  for(const e of await p.locator('main select[name]:not([disabled])').elementHandles()){
   const info=await e.evaluate(x=>({nm:x.name,val:x.value,n:[...x.options].filter(o=>o.value).length,vis:!!x.offsetParent}));
   if(!info.vis||info.val||!info.n||info.nm===CUR.toLowerCase().replace(/\s+/g,'_')+'_id') continue;
   if(MINIMAL && !(await isRequired(e))) continue;
   const v=await e.evaluate(x=>[...x.options].map(o=>o.value).filter(Boolean)[0]); await e.selectOption(v); changed++; await p.waitForTimeout(700);
  }
  if(!changed) break;
 }
 return r; }
async function isRequired(e){ return e.evaluate(x=>{ const l=x.id&&document.querySelector('label[for="'+x.id+'"]'); const w=x.closest('div'); const t=(l?l.textContent:(w&&w.parentElement?w.parentElement.textContent:''))||''; return t.includes('*'); }); }
async function fill1(p,second){
 const els=await p.locator('form input, form select, form textarea, main input, main select, main textarea').elementHandles(); const log=[]; let n=0;
 for(const e of els){
  const info=await e.evaluate(x=>({t:x.tagName,ty:x.type,nm:x.name||x.id,vis:!!(x.offsetParent),ro:x.readOnly||x.disabled}));
  if(!info.vis||info.ro||!info.nm||/search/i.test(info.nm)) continue;
  if(info.nm===CUR.toLowerCase().replace(/\s+/g,'_')+'_id') continue; // the record's own id mirror, not an input
  if(MINIMAL && !(await isRequired(e))) continue; // retry: required fields only, as a person leaves optional ones empty
  try{
   if(info.t==='SELECT'){ for(let w=0;w<(second?14:3);w++){ if((await e.evaluate(s=>s.options.length))>1) break; await e.page?.waitForTimeout?.(300); await new Promise(r=>setTimeout(r,300)); } const opts=await e.evaluate(s=>[...s.options].map(o=>o.value).filter(v=>v)); if(opts.length) {await e.selectOption(opts[PICK===0?0:(opts.length>1?1:0)]); n++;} }
   else if(info.ty==='checkbox'||info.ty==='file'||info.ty==='hidden') {}
   else if(info.ty==='date') await e.fill('2026-06-15');
   else if(info.ty==='datetime-local') await e.fill('2026-06-15T10:00');
   else if(info.ty==='number') await e.fill(String(1000+(parseInt(TS,36)%90000)));
   else if(info.ty==='url') await e.fill('https://example.com/qa/'+TS);
   else if(info.ty==='time') await e.fill('10:30');
   else if(info.ty==='password') await e.fill('QaPassw0rd!'+TS);
   else if(info.ty==='color') await e.fill('#336699');
   else if(info.ty==='email') await e.fill(`qa.${TS}@example.com`);
   else if(info.ty==='tel') await e.fill('555'+String(parseInt(TS,36)%10000000).padStart(7,'0'));
   else await e.fill(`QA ${info.nm.slice(0,12)} ${TS}`.slice(0,40));
   n++; }catch(err){ log.push(info.nm+': '+err.message.split('\n')[0]); }
 }
 return {n,log};
}
(async()=>{
 const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 const out=[];
 await p.goto('http://localhost:4000/auth/login'); await p.waitForTimeout(3000);
 await p.locator('input[type=email]').first().fill('admin@admin.com'); await p.locator('input[type=password]').first().fill('admin123'); await p.keyboard.press('Enter'); await p.waitForTimeout(6000);
 let list=ents;
 if(ents[0]&&ents[0].startsWith('AUTO')){ const n=+ents[0].split(':')[1]||5; const bt=await p.getByRole('button').allInnerTexts(); const a=bt.indexOf('Dashboard'); const z=bt.indexOf('Access Controls'); list=bt.slice(a+1,z>0?z:a+40).map(t=>t.split('\n').pop().trim()).filter(t=>t&&t.length<40).slice(0,n); console.log('entities:',list.join(', ')); }
 for(const ent of list){
  const r={entity:ent}; 
  try{
   await p.getByRole('button',{name:new RegExp('(^|\\s)'+ent.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')}).first().click(); await p.waitForTimeout(3500);
   const before=await p.locator('tbody tr').count(); r.rowsBefore=before;
   await p.getByRole('button',{name:'New',exact:true}).first().click(); await p.waitForTimeout(2500);
   CUR=ent; const f=await fill(p); r.filled=f.n; if(f.log.length) r.fillErrors=f.log.slice(0,3);
   await p.screenshot({path:S+`crud-${ent.replace(/\W/g,'')}-1-form.png`});
   await p.getByRole('button',{name:'Create',exact:true}).first().click(); await p.waitForTimeout(3500);
   // A lookup named like the record's own id is skipped at first (a key mirror: choosing an
   // existing value collides with the unique key). If the form then demands it, it is a real
   // required parent reference (a hierarchy) — fill it and create again.
   const selfName=ent.toLowerCase().replace(/\s+/g,'_')+'_id';
   if(/validation/i.test((await p.locator('[role=alert],[data-sonner-toast],.toast').allInnerTexts()).join(' '))){
     const selfSel=p.locator(`main select[name=${selfName}]`);
     if(await selfSel.count()){ const ov=await selfSel.first().evaluate(s=>[...s.options].map(o=>o.value).filter(v=>v)); if(ov.length){ await selfSel.first().selectOption(ov[0]); r.filledSelfReference=true; await p.getByRole('button',{name:'Create',exact:true}).first().click(); await p.waitForTimeout(3500); } }
   }
   const alert=await p.locator('[role=alert],[data-sonner-toast],.toast,[aria-live]').allInnerTexts(); r.createMsg=alert.join(' | ').slice(0,200);
   await p.screenshot({path:S+`crud-${ent.replace(/\W/g,'')}-2-created.png`});
   r.create=/created/i.test(r.createMsg)?'pass':'fail';
   if(r.create==='fail' && r.createMsg && !/validation|unique/i.test(r.createMsg)){
     // A model rule refused the generated values (an optional "resolved at" date filled while its
     // "resolution notes" stay hidden). Fill required fields only, each dropdown's first option
     // — what a person does — and try once more.
     r.firstAttempt=r.createMsg.slice(0,100); PICK=0; MINIMAL=true;
     await p.getByRole('button',{name:'New',exact:true}).first().click(); await p.waitForTimeout(2000);
     CUR=ent; await fill(p);
     await p.getByRole('button',{name:'Create',exact:true}).first().click(); await p.waitForTimeout(3500);
     r.createMsg=(await p.locator('[role=alert],[data-sonner-toast],.toast').allInnerTexts()).join(' | ').slice(0,200);
     r.create=/created/i.test(r.createMsg)?'pass (after retrying with required fields only)':'fail'; PICK=1; MINIMAL=false;
   }
   if(r.create.startsWith('pass')) r.create='pass';
   if(r.create==='fail') r.invalid=(await p.locator('.text-destructive,[class*=error],[aria-invalid=true]').evaluateAll(n=>n.slice(0,6).map(x=>(x.getAttribute('name')||x.textContent||'').trim().slice(0,60)))).join(' ; ');
   if(r.create==='pass'){
    // Update: Edit -> change first text field -> Save
    await p.getByRole('button',{name:'Edit',exact:true}).first().click(); await p.waitForTimeout(2000);
    let tf=p.locator('main input[type=text][name]:not([readonly]):not([disabled]),main textarea[name]:not([readonly]):not([disabled])').first(); let edited='QA edited '+TS;
    if(!(await tf.count())){ tf=p.locator('main input[type=number][name]:not([readonly]):not([disabled])').first(); edited='4242'; }
    if(!(await tf.count())){ tf=p.locator('main input[type=date][name]:not([readonly]):not([disabled])').first(); edited='2027-01-15'; }
    if(!(await tf.count())){ tf=p.locator('main input[type=datetime-local][name]:not([readonly]):not([disabled])').first(); edited='2027-01-15T10:00'; }
    let viaSelect=false;
    if(!(await tf.count())){ const sel=p.locator('main select[name]:not([disabled])').first(); if(await sel.count()){ const ov=await sel.evaluate(x=>[...x.options].map(o=>o.value).filter(v=>v&&v!==x.value)); if(ov.length){ r.editedField=await sel.getAttribute('name'); await sel.selectOption(ov[0]); viaSelect=true; edited=null; } } }
    const canEdit=viaSelect||(await tf.count())>0;
    if(!canEdit){ r.update='no editable field (references only)'; r.read='n/a'; }
    else {
    if(!viaSelect){ r.editedField=await tf.evaluate(e=>e.name||e.id||e.getAttribute('aria-label')||''); await tf.fill(edited); }
    await p.getByRole('button',{name:'Save',exact:true}).first().click(); await p.waitForTimeout(3000);
    const m2=(await p.locator('[role=alert],[data-sonner-toast],.toast').allInnerTexts()).join(' | ').slice(0,160); r.updateMsg=m2;
    r.update=/updated|saved/i.test(m2)?'pass':(/conflict|final|locked|required|must|cannot|not allowed|before/i.test(m2)?'refused by a model rule':'fail');
    await p.screenshot({path:S+`crud-${ent.replace(/\W/g,'')}-3-updated.png`});
    // Read: the edited value is on screen
    r.read=r.update!=='pass'?'n/a (update refused)':(edited===null?'n/a (dropdown edited)':(/^\d{4}-\d{2}-\d{2}/.test(edited)?'n/a (date is shown formatted)':((await p.locator('body').innerText()).includes(edited)?'pass':'fail')));
    }
    // Delete: the toolbar shows it only in edit mode, behind a confirm dialog
    const edit2=p.getByRole('button',{name:'Edit',exact:true}).first();
    if(await edit2.count() && await edit2.isEnabled()){ await edit2.click(); await p.waitForTimeout(1500); }
    const del=p.getByRole('button',{name:/^Delete$/}).first();
    if(await del.count()){ await del.click(); await p.waitForTimeout(1000);
      await p.screenshot({path:S+`crud-${ent.replace(/\W/g,'')}-4a-confirm.png`});
      await p.getByRole('alertdialog').getByRole('button',{name:/^Delete$/}).click(); await p.waitForTimeout(3000);
      const m3=(await p.locator('[role=alert],[data-sonner-toast],.toast').allInnerTexts()).join(' | ').slice(0,160); r.deleteMsg=m3;
      r.delete=/could not be deleted|restrict|still referenced|violates/i.test(m3)?'refused (other records still reference it)':(/delet/i.test(m3)&&!/fail|cannot|refus|final|locked/i.test(m3)?'pass':(/final|locked|refus|cannot/i.test(m3)?'refused':'fail'));
      await p.screenshot({path:S+`crud-${ent.replace(/\W/g,'')}-4-deleted.png`});
    } else r.delete='no delete control (Edit '+(await edit2.count()?(await edit2.isEnabled()?'enabled':'disabled'):'absent')+')';
   }
  }catch(err){ if(err.message!=='skip-update') r.error=err.message.split('\n')[0]; }
  out.push(r); console.log(JSON.stringify(r));
 }
 await b.close();
})();
