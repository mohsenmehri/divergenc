/* Offline tools controller. Only inventory + non-secret checklist definitions persist.
   Observed configuration, scenarios, reports and file previews stay in closure RAM. */
(()=>{
 'use strict';const M=FamEquipmentInventory,T=FamEquipmentToolsModel,E=FamEquipmentExcel,KEY='fam.equipment.standards.v1';
 function create({getInventory,saveInventory,isAuthorized}){
  let pane=null,mode='excel',generation=0,preview=null,importError='',update=false,standards={version:1,items:[]},standardIssue='';
  let draft=null,nodeId='',observed='',auditResult=null,auditQuery='',selected=new Set(),scenarios={},filters={},page=0,errResult=null,errSignature='',errAt='';
  let errRevision=0,repairDialog=null,portSelected=new Set(),recovered=new Set();
  try{const raw=localStorage.getItem(KEY);if(raw!==null)standards=T.validateStandards(JSON.parse(raw));}catch(e){standardIssue='استانداردهای ذخیره‌شده قابل خواندن نیست؛ برای حفظ اطلاعات ویرایش غیرفعال است.';}
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,handler,cls='btn btn-ghost btn-sm')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',handler);const permission=({'خروجی همهٔ تجهیزات':'equipment-export','خروجی اکسل چک‌لیست':'equipment-audit','ذخیره استاندارد':'equipment-standards'})[text];if(permission&&!isAuthorized(permission))b.disabled=true;if(text==='دریافت فرم ورود از دسته‌های فعلی'&&!isAuthorized('equipment-import')&&!isAuthorized('equipment-export'))b.disabled=true;return b;};
  const tools=(...items)=>{const row=el('div','eq-tools');row.append(...items);return row;};
  const note=(text,warning=false)=>el('div','eq-notice'+(warning?' warning':''),text);
  const find=(key,id)=>getInventory().catalog[key].find(x=>x.id===id),name=(key,id)=>find(key,id)?.name||'حذف‌شده / نامشخص';
  const id=()=>crypto.randomUUID(),allowed=(operation='equipment')=>{if(!isAuthorized(operation))throw Error('دوباره وارد مدیریت تجهیزات شوید.');};
  function select(parent,label,items,value,handler,key,all='انتخاب کنید…'){
   const wrap=el('label','eq-field',label),s=el('select','inp');if(key)s.id=key;const empty=el('option','',all);empty.value='';s.append(empty);
   for(const item of items){const o=el('option','',item.name);o.value=item.id;s.append(o);}if(value&&!items.some(x=>x.id===value)){const o=el('option','','دستهٔ قبلی حذف شده؛ اصلاح کنید');o.value=value;s.append(o);}s.value=value||'';
   if(handler)s.addEventListener('change',()=>handler(s.value));wrap.append(s);parent.append(wrap);return s;
  }
  function input(parent,label,value,handler,key,max=80){const wrap=el('label','eq-field',label),n=el('input','inp');n.value=value||'';n.maxLength=max;if(key)n.id=key;n.addEventListener('input',()=>handler(n.value));wrap.append(n);parent.append(wrap);return n;}
  function check(parent,text,value,handler,key){const wrap=el('label','eq-tool-checkbox'),n=el('input');n.type='checkbox';n.checked=value;if(key)n.id=key;n.addEventListener('change',()=>handler(n.checked));wrap.append(n,el('span','',text));parent.append(wrap);return n;}
  function table(parent,headers,rows){const wrap=el('div','eq-table-wrap'),table=el('table','eq-table'),head=el('thead'),hr=el('tr');headers.forEach(x=>hr.append(el('th','',x)));head.append(hr);table.append(head);const body=el('tbody');rows.forEach(cells=>{const row=el('tr');cells.forEach(text=>row.append(el('td','',String(text??''))));body.append(row);});table.append(body);wrap.append(table);parent.append(wrap);return body;}
  function download(sheets,filename){allowed();const book=XLSX.utils.book_new();for(const [title,rows]of sheets){const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=(rows[0]||[]).map((_,i)=>({wch:i===0?28:24}));XLSX.utils.book_append_sheet(book,sheet,title);}XLSX.writeFile(book,filename,{bookType:'xlsx',compression:true});}
  function exportInventory(){allowed('equipment-export');E.download(getInventory(),{includeNodes:true});}
  function template(){allowed(isAuthorized('equipment-import')?'equipment-import':'equipment-export');E.download(getInventory());}
  function excel(parent){
   parent.append(note('ورود اکسل واقعیِ مشخصات تجهیزات؛ بدون تغییر فایل‌های پایگاه داده. ثبت فقط پس از پیش‌نمایش و تأیید انجام می‌شود. رمز یا کانفیگ در فایل تجهیزات نگذارید.'));
   const templateButton=button('دریافت فرم ورود از دسته‌های فعلی',template);templateButton.id='eq-download-template';parent.append(tools(templateButton,button('خروجی همهٔ تجهیزات',exportInventory)));
   parent.append(note('قالب زنده است: هر بار از آخرین دسته‌ها و نام‌های همین برنامه ساخته می‌شود؛ دسته‌ها فقط از فهرست مجاز با خطای توقف انتخاب می‌شوند؛ مدل، محل و الگوها وابسته‌اند. دستهٔ جدید را ابتدا در برنامه بسازید. ابتدا فرم به‌روز بگیرید، ردیف‌ها را تکمیل و سپس همین‌جا وارد کنید. بعد از تغییر دسته‌ها، فایل قبلی قابل ورود نیست.'));
   const options=el('div','eq-tool-options');check(options,'به‌روزرسانی نودهای موجود بر اساس شناسه / IP',update,value=>{update=value;preview=null;draw();},'eq-import-update');parent.append(options);
   const label=el('label','eq-field','انتخاب فایل xlsx تجهیزات'),file=el('input','inp');file.disabled=!isAuthorized('equipment-import');file.type='file';file.accept='.xlsx';file.id='eq-inventory-file';label.append(file);parent.append(label);
   file.addEventListener('change',async()=>{
    const f=file.files[0],token=++generation;preview=null;importError='';if(!f)return;
    try{allowed('equipment-import');if(!/\.xlsx$/i.test(f.name)||f.size>5*1024*1024)throw Error('فقط xlsx با اندازهٔ حداکثر ۵ مگابایت مجاز است.');
     const buffer=await f.arrayBuffer();if(token!==generation||!isAuthorized())return;
     const imported=E.read(buffer);T.assertCatalogSnapshot(getInventory(),imported.snapshot);const rows=imported.rows;
     preview=T.prepareImport(getInventory(),rows,{update});
    }catch(e){importError=e.message;}if(token===generation&&isAuthorized())draw();
   });
   if(importError)parent.append(note(importError,true));
   if(preview){const p=preview;parent.append(note(p.counts.added+' نود جدید · '+p.counts.updated+' ویرایش · '+p.counts.categories+' دستهٔ جدید · '+p.errors.length+' خطا — هنوز ثبت نشده است.',!!p.errors.length));
    if(p.errors.length){table(parent,['ردیف','خطا'],p.errors.slice(0,100).map(x=>[x.row||'کل فایل',x.message]));if(p.errors.length>100)parent.append(note('فقط ۱۰۰ خطای اول نمایش داده شده؛ همهٔ خطاها باید برطرف شوند.'));}
    else{const body=table(parent,['نام','IP','نوع / مدل','منطقه / محل'],p.next.nodes.slice(0,25).map(n=>[n.name,n.host,p.next.catalog.models.find(x=>x.id===n.modelId)?.name||'',p.next.catalog.sites.find(x=>x.id===n.siteId)?.name||'']));body.closest('table').setAttribute('aria-label','پیش‌نمایش موجودی پس از ورود');parent.append(note('پیش‌نمایش ۲۵ نود اولِ کل موجودیِ پس از ثبت؛ هیچ نودی خارج از فایل حذف نمی‌شود.'));
     const apply=button('تأیید و ثبت ورود',()=>{try{allowed('equipment-import');if(p.base!==JSON.stringify(M.validate(getInventory())))throw Error('موجودی تغییر کرده؛ فایل را دوباره پیش‌نمایش کنید.');if(!confirm('ورود '+p.counts.added+' نود جدید و ویرایش '+p.counts.updated+' نود ثبت شود؟'))return;saveInventory(p.next);preview=null;importError='ورود با موفقیت ثبت شد؛ دسته‌بندی‌ها خودکار به‌روز شدند.';draw();}catch(e){importError=e.name==='QuotaExceededError'?'فضای مرورگر کافی نیست؛ هیچ ردیفی ثبت نشد.':e.message;draw();}},'btn btn-primary');apply.id='eq-import-apply';parent.append(apply);}
   }
  }
  function newDraft(){return {id:id(),name:'',modelId:'',siteKindId:null,siteId:null,checks:[{id:id(),name:'',operator:'exact-line',pattern:''}]};}
  function saveStandards(next){allowed('equipment-standards');if(standardIssue)throw Error(standardIssue);const clean=T.validateStandards(next);try{localStorage.setItem(KEY,JSON.stringify(clean));}catch(e){throw Error('استاندارد ذخیره نشد؛ فضای مرورگر را بررسی کنید.');}standards=clean;auditResult=null;}
  function standardsUI(parent){
   parent.append(note('استاندارد بر اساس مدل و محل استفاده اعمال می‌شود. آیتم‌ها تطبیق متنیِ دادهٔ آزمایشی‌اند، نه تحلیل کامل Cisco. متن کانفیگ واقعی یا رمز وارد نکنید.'));
   if(standardIssue)parent.append(note(standardIssue,true));
   const grid=el('div','eq-tool-grid'),editor=el('form','eq-tool-card'),list=el('div','eq-tool-card');draft??=newDraft();const s=draft;
   editor.append(el('h4','','تعریف استاندارد و چک‌لیست'));
   input(editor,'نام استاندارد',s.name,v=>s.name=v,'eq-standard-name');
   const models=getInventory().catalog.models.filter(x=>['router','switch'].includes(find('types',x.typeId)?.kind));
   select(editor,'مدل روتر / سوئیچ',models,s.modelId,v=>s.modelId=v,'eq-standard-model');
   select(editor,'نوع محل (اختیاری)',getInventory().catalog.siteKinds,s.siteKindId,v=>{s.siteKindId=v||null;s.siteId=null;draw();},'eq-standard-kind','همهٔ محل‌ها');
   select(editor,'محل دقیق (اختیاری)',getInventory().catalog.sites.filter(x=>!s.siteKindId||x.siteKindId===s.siteKindId),s.siteId,v=>{s.siteId=v||null;if(v)s.siteKindId=find('sites',v).siteKindId;draw();},'eq-standard-site','همهٔ محل‌های مرتبط');
   s.checks.forEach((c,i)=>{const row=el('div','eq-tool-check');input(row,'عنوان آیتم '+(i+1),c.name,v=>c.name=v,'eq-standard-check-'+i);select(row,'روش مقایسه',[{id:'exact-line',name:'وجود خط دقیق'},{id:'contains',name:'وجود عبارت'},{id:'not-contains',name:'نبود عبارت'}],c.operator,v=>c.operator=v,'eq-standard-op-'+i);input(row,'عبارت یا خط مورد انتظار',c.pattern,v=>c.pattern=v,'eq-standard-pattern-'+i,300);row.append(button('حذف آیتم',()=>{s.checks.splice(i,1);draw();},'eq-mini-action eq-danger'));editor.append(row);});
   const add=button('＋ آیتم چک‌لیست',()=>{s.checks.push({id:id(),name:'',operator:'exact-line',pattern:''});draw();});add.disabled=s.checks.length>=50||!!standardIssue;
   const error=el('div','eq-error');error.setAttribute('role','alert');const submit=el('button','btn btn-primary','ذخیره استاندارد');submit.type='submit';submit.id='eq-standard-save';submit.disabled=!!standardIssue||!isAuthorized('equipment-standards');editor.append(add,error,tools(submit,button('فرم استاندارد جدید',()=>{draft=newDraft();draw();})));
   editor.addEventListener('submit',event=>{event.preventDefault();try{const model=find('models',s.modelId);if(!model||!['router','switch'].includes(find('types',model.typeId)?.kind)||s.siteKindId&&!find('siteKinds',s.siteKindId)||s.siteId&&find('sites',s.siteId)?.siteKindId!==s.siteKindId)throw Error('مدل و محل معتبر و سازگار انتخاب کنید.');const next=structuredClone(standards),at=next.items.findIndex(x=>x.id===s.id);if(at<0)next.items.push(s);else next.items[at]=s;saveStandards(next);draft=newDraft();draw();}catch(e){error.textContent=e.message;}});
   list.append(el('h4','','استانداردهای تعریف‌شده'));
   for(const policy of standards.items.filter(p=>find('models',p.modelId)&&(!p.siteKindId||find('siteKinds',p.siteKindId))&&(!p.siteId||find('sites',p.siteId)))){const row=el('article','eq-tool-policy');row.append(el('strong','',policy.name),el('p','eq-muted',name('models',policy.modelId)+' · '+(policy.siteId?name('sites',policy.siteId):policy.siteKindId?name('siteKinds',policy.siteKindId):'همهٔ محل‌ها')+' · '+policy.checks.length+' آیتم'));
    const edit=button('ویرایش',()=>{draft=structuredClone(policy);draw();}),remove=button('حذف',()=>{if(!confirm('فقط استاندارد «'+policy.name+'» حذف شود؟ نودها حذف نمی‌شوند.'))return;try{saveStandards({version:1,items:standards.items.filter(x=>x.id!==policy.id)});draft=newDraft();draw();}catch(e){alert(e.message);}});edit.disabled=remove.disabled=!!standardIssue||!isAuthorized('equipment-standards');edit.setAttribute('aria-label','ویرایش استاندارد '+policy.name);remove.setAttribute('aria-label','حذف استاندارد '+policy.name);row.append(tools(edit,remove));list.append(row);}
   if(!standards.items.length)list.append(note('استانداردی تعریف نشده؛ نتیجهٔ بررسی بدون استاندارد «تأییدشده» محسوب نمی‌شود.'));grid.append(editor,list);parent.append(grid);
   const audit=el('section','eq-tool-card');audit.append(el('h4','','بررسی نود و خروجی چک‌لیست'));
   const nodeSelectBox=el('div');input(audit,'جست‌وجوی نام یا IP نود',auditQuery,v=>{auditQuery=v;drawNodeOptions();},'eq-audit-search');
   function drawNodeOptions(){nodeSelectBox.replaceChildren();const nodes=getInventory().nodes.filter(n=>n.id===nodeId||[n.name,n.host].some(x=>x.toLowerCase().includes(auditQuery.toLowerCase())));select(nodeSelectBox,'نود مورد بررسی',nodes.map(n=>({id:n.id,name:n.name+' · '+n.host})),nodeId,v=>{nodeId=v;observed='';auditResult=null;draw();},'eq-audit-node');}
   drawNodeOptions();audit.append(nodeSelectBox);if(nodeId){const n=getInventory().nodes.find(n=>n.id===nodeId);if(n)audit.append(note(name('models',n.modelId)+' · '+name('sites',n.siteId)));}
   const observedLabel=el('label','eq-field','کانفیگ ساختگی همین نود (فقط RAM)'),text=el('textarea','inp eq-tool-observed');text.id='eq-audit-observed';text.dir='ltr';text.maxLength=12000;text.spellcheck=false;text.autocomplete='off';text.value=observed;observedLabel.append(text);audit.append(observedLabel);
   const report=el('div');report.id='eq-audit-report';const exportButton=button('خروجی اکسل چک‌لیست',()=>{try{allowed('equipment-audit');if(!auditResult)throw Error('ابتدا بررسی را اجرا کنید.');const live=T.audit(getInventory(),standards,nodeId,observed);if(live.signature!==auditResult.signature)throw Error('نود یا استاندارد تغییر کرده؛ بررسی را دوباره اجرا کنید.');download([['چک‌لیست',[
    ['منبع','نود','IP','استاندارد','آیتم','نتیجه','زمان'],...auditResult.rows.map(r=>[auditResult.source,auditResult.node.name,auditResult.node.host,r.standard,r.check,auditLabel(r.status),auditResult.at])]]],'FAM-Checklist-DEMO.xlsx');}catch(e){report.replaceChildren(note(e.message,true));}});exportButton.id='eq-audit-export';exportButton.disabled=!isAuthorized('equipment-audit')||!auditResult?.rows.length;
   text.addEventListener('input',()=>{observed=text.value;auditResult=null;report.replaceChildren();exportButton.disabled=true;});
   const run=button('بررسی چک‌لیست آزمایشی',()=>{try{allowed('equipment-audit');auditResult={...T.audit(getInventory(),standards,nodeId,observed),at:new Date().toISOString()};draw();}catch(e){report.replaceChildren(note(e.message,true));}},'btn btn-primary');run.id='eq-audit-run';run.disabled=!!standardIssue||!isAuthorized('equipment-audit');
   audit.append(tools(run,exportButton),report);if(auditResult){report.append(note(auditResult.source+'؛ نتیجه، وضعیت واقعی دستگاه نیست.'));if(!auditResult.rows.length)report.append(note('استاندارد متناسب با مدل و محل این نود تعریف نشده است.',true));else table(report,['استاندارد','آیتم','نتیجه'],auditResult.rows.map(r=>[r.standard,r.check,auditLabel(r.status)]));}parent.append(audit);
  }
  const auditLabel=status=>({ok:'منطبق (آزمایشی)',fail:'نامنطبق (آزمایشی)',unknown:'نامشخص / بررسی‌نشده'})[status];
  const errLabel=scenario=>({unknown:'سناریو تعیین نشده',clean:'پاک — نمایشی',errdisabled:'Err-disabled — نمایشی',auth:'احراز هویت ناموفق — نمایشی',timeout:'پایان زمان — نمایشی',connection:'خطای اتصال — نمایشی'})[scenario];
  const scenarioItems=['clean','errdisabled','auth','timeout','connection'].map(x=>({id:x,name:errLabel(x)}));
  function errdisabledUI(parent){
   const steps=el('ol','eq-err-steps');['انتخاب سوئیچ‌ها','بررسی پورت‌ها','انتخاب پورت خطادار','تأیید رفع خطا'].forEach((label,i)=>{const item=el('li','',label);if(i===(errResult?(portSelected.size?3:2):(selected.size?1:0)))item.setAttribute('aria-current','step');steps.append(item);});parent.append(steps);
   parent.append(note('فقط سوئیچ‌ها بر اساس الگوی نوع تجهیز (switch)، نه نام آن‌ها. بررسی فعلاً سناریوی نمایشی است؛ انتخاب‌نکردن سناریو هرگز به معنی وضعیت پاک نیست. بررسی و رفع خطا در این نسخه فقط نمایشی‌اند؛ وضعیت واقعی پورت خوانده یا تغییر داده نمی‌شود.',true));
   const bar=el('div','eq-filters');for(const [field,key,title]of [['typeId','types','نوع سوئیچ'],['modelId','models','مدل'],['regionId','regions','منطقه'],['siteId','sites','محل']]){
    let items=getInventory().catalog[key];if(key==='types')items=items.filter(x=>x.kind==='switch');if(key==='models')items=items.filter(x=>find('types',x.typeId)?.kind==='switch'&&(!filters.typeId||x.typeId===filters.typeId));
    select(bar,title,items,filters[field],v=>{if(v)filters[field]=v;else delete filters[field];if(field==='typeId')delete filters.modelId;page=0;draw();},'eq-err-filter-'+field,'همه');
   }parent.append(bar);
   const nodes=T.switches(getInventory(),filters),maxPage=Math.max(0,Math.ceil(nodes.length/25)-1);page=Math.min(page,maxPage);
   parent.append(note(nodes.length+' سوئیچ در این فیلتر · '+selected.size+' سوئیچ انتخاب‌شده در همهٔ گروه‌ها'));
   const selectionBar=el('div','eq-tools'),allSelected=nodes.length>0&&nodes.every(n=>selected.has(n.id));
   const group=check(selectionBar,'تیک همهٔ سوئیچ‌های این دسته',allSelected,value=>{nodes.forEach(n=>value?selected.add(n.id):selected.delete(n.id));invalidateErr();draw();},'eq-err-group-toggle');group.disabled=!nodes.length;group.indeterminate=!allSelected&&nodes.some(n=>selected.has(n.id));
   selectionBar.append(button('پاک‌کردن انتخاب‌ها',()=>{selected.clear();invalidateErr();draw();}));parent.append(selectionBar);
   const bulk=el('div','eq-tool-options');let bulkScenario='';select(bulk,'سناریوی ساختگی برای انتخاب‌شده‌ها',scenarioItems,'',v=>bulkScenario=v,'eq-err-bulk','انتخاب سناریو');bulk.append(button('اعمال سناریو',()=>{if(!bulkScenario)return;selected.forEach(id=>scenarios[id]=bulkScenario);invalidateErr();draw();}));parent.append(bulk);
   const list=el('div','eq-tool-switch-list');for(const n of nodes.slice(page*25,page*25+25)){const row=el('div','eq-tool-switch');check(row,n.name+' · '+n.host,selected.has(n.id),v=>{v?selected.add(n.id):selected.delete(n.id);invalidateErr();draw();},'eq-err-node-'+n.id);row.append(el('span','eq-muted',name('models',n.modelId)+' · '+name('regions',n.regionId)));select(row,'سناریوی این سوئیچ',scenarioItems,scenarios[n.id],v=>{scenarios[n.id]=v||'unknown';invalidateErr();draw();},'eq-err-scenario-'+n.id,'بررسی نشده');list.append(row);}parent.append(list);
   if(nodes.length>25){const prev=button('قبلی',()=>{page--;draw();}),next=button('بعدی',()=>{page++;draw();});prev.disabled=page===0;next.disabled=page===maxPage;parent.append(tools(prev,el('span','eq-muted','صفحه '+(page+1)+' از '+(maxPage+1)),next));}
   const report=el('div');report.id='eq-err-report';const run=button('بررسی پورت‌های سوئیچ‌های انتخاب‌شده (نمایشی)',()=>{try{allowed('equipment-scan');if(!selected.size)throw Error('حداقل یک سوئیچ انتخاب کنید.');if(!confirm('بررسی نمایشی '+selected.size+' سوئیچ انتخاب‌شده در همهٔ دسته‌ها انجام شود؟ هیچ اتصالی برقرار نمی‌شود.'))return;invalidateErr();errResult=T.simulateErr(getInventory(),[...selected],scenarios);errSignature=JSON.stringify(getInventory());errAt=new Date().toISOString();draw();}catch(e){report.replaceChildren(note(e.message,true));}},'btn btn-primary');run.id='eq-err-run';run.disabled=!isAuthorized('equipment-scan');
   const exportButton=button('خروجی اکسل Err-disabled',()=>{try{allowed('equipment-scan');if(!errResult||errSignature!==JSON.stringify(getInventory()))throw Error('موجودی تغییر کرده؛ دوباره بررسی کنید.');download([['Err-disabled',[
    ['منبع','سوئیچ','IP','مدل','نتیجه بررسی','پورت ساختگی','رفع نمایشی','زمان'],...errResult.flatMap(r=>(r.ports.length?r.ports:['']).map(port=>[r.source,r.node.name,r.node.host,name('models',r.node.modelId),errLabel(r.scenario),port,port?(recovered.has(r.node.id+':'+port)?'رفع نمایشی شد؛ وضعیت واقعی نامعلوم':'انجام نشده'):'غیرقابل رفع',errAt]))]]],'FAM-Errdisabled-DEMO.xlsx');}catch(e){report.replaceChildren(note(e.message,true));}});exportButton.id='eq-err-export';exportButton.disabled=!errResult||!isAuthorized('equipment-scan');parent.append(tools(run,exportButton),report);
   if(errResult){
    report.append(el('h4','','نتیجهٔ بررسی پورت‌ها'),note('نام و IP سوئیچ کنار هر پورت مشخص است. فقط پورت‌های خطادار را برای رفع انتخاب کنید؛ نتایج و رفع همگی نمایشی‌اند.'));
    table(report,['سوئیچ','IP','نتیجه بررسی','پورت‌های خطادار'],errResult.map(r=>[r.node.name,r.node.host,errLabel(r.scenario),r.ports.join('، ')||'—']));
    const ports=errResult.flatMap(r=>r.ports.map(port=>({key:r.node.id+':'+port,node:r.node,port}))),pending=ports.filter(p=>!recovered.has(p.key));
    if(ports.length){const toolbar=el('div','eq-tools'),all=pending.length>0&&pending.every(p=>portSelected.has(p.key));const master=check(toolbar,'تیک همهٔ پورت‌های خطادارِ رفع‌نشده',all,value=>{closeRepair();pending.forEach(p=>value?portSelected.add(p.key):portSelected.delete(p.key));errRevision++;draw();},'eq-err-port-all');master.disabled=!pending.length;master.indeterminate=!all&&pending.some(p=>portSelected.has(p.key));report.append(toolbar);
     const list=el('div','eq-err-port-list');for(const p of ports){const row=el('div','eq-err-port-row'),status=recovered.has(p.key)?'رفع نمایشی شد — وضعیت واقعی نامعلوم':'Err-disabled — نمایشی';const box=check(row,p.node.name+' · '+p.node.host+' · '+p.port,portSelected.has(p.key),value=>{closeRepair();value?portSelected.add(p.key):portSelected.delete(p.key);errRevision++;draw();});box.dataset.portKey=p.key;box.disabled=recovered.has(p.key);row.append(el('span','eq-muted',status));list.append(row);}report.append(list);
     const repair=button('بازبینی و تأیید رفع پورت‌های انتخاب‌شده',()=>{try{allowed('equipment-repair');openRepair();}catch(e){report.append(note(e.message,true));}},'btn btn-primary');repair.id='eq-err-repair-review';repair.disabled=!portSelected.size||!isAuthorized('equipment-repair');report.append(tools(repair));
    }else report.append(note('پورت خطاداری برای رفع گزارش نشده است. نتیجهٔ نامشخص به معنی پاک‌بودن نیست.'));
   }
  }
  function closeRepair(){const dialog=repairDialog;repairDialog=null;if(dialog){dialog.close();dialog.remove();}}
  function invalidateErr(){errRevision++;closeRepair();errResult=null;portSelected.clear();recovered.clear();}
  function openRepair(){
   if(!errResult||errSignature!==JSON.stringify(getInventory()))throw Error('موجودی تغییر کرده؛ دوباره پورت‌ها را بررسی کنید.');
   const keys=[...portSelected],plan=T.errRecoveryPlan(getInventory(),errResult,keys),revision=errRevision,signature=JSON.stringify(errResult);closeRepair();
   const dialog=el('dialog','eq-dialog eq-err-confirm');repairDialog=dialog;dialog.id='eq-err-repair-dialog';dialog.setAttribute('aria-labelledby','eq-err-repair-title');
   const title=el('h3','','تأیید رفع خطای پورت‌ها — فقط نمایشی');title.id='eq-err-repair-title';dialog.append(title,note(plan.targets.length+' پورت از '+new Set(plan.targets.map(t=>t.nodeId)).size+' سوئیچ؛ فقط همین مقصدها. هیچ فرمان یا اتصال واقعی اجرا نمی‌شود.',true));
   table(dialog,['سوئیچ','IP','پورت دقیق'],plan.targets.map(t=>[t.name,t.host,t.port]));
   const ack=check(dialog,'نام سوئیچ، IP و پورت‌های بالا را بررسی کردم؛ رفع فقط نمایشی است.',false,value=>apply.disabled=!value,'eq-err-repair-ack');
   const error=el('div','eq-error');error.setAttribute('role','alert');
   const apply=button('تأیید و رفع نمایشی خطا',()=>{try{
    allowed('equipment-repair');if(!ack.checked||revision!==errRevision||signature!==JSON.stringify(errResult)||JSON.stringify(keys)!==JSON.stringify([...portSelected])||errSignature!==JSON.stringify(getInventory()))throw Error('انتخاب یا نتیجه تغییر کرده؛ دوباره بررسی و تأیید کنید.');
    const live=T.errRecoveryPlan(getInventory(),errResult,keys);if(JSON.stringify(live)!==JSON.stringify(plan))throw Error('مقصدها تغییر کرده‌اند؛ دوباره بررسی کنید.');
    live.targets.forEach(t=>recovered.add(t.key));portSelected.clear();errRevision++;closeRepair();draw();
   }catch(e){error.textContent=e.message;apply.disabled=true;}},'btn btn-primary');apply.id='eq-err-repair-apply';apply.disabled=true;
   const cancel=button('انصراف',closeRepair);cancel.id='eq-err-repair-cancel';dialog.append(error,tools(apply,cancel));dialog.addEventListener('cancel',event=>{event.preventDefault();closeRepair();});document.body.append(dialog);dialog.showModal();
  }
  function draw(){if(!pane)return;pane.replaceChildren();const nav=el('nav','eq-tabs');nav.setAttribute('aria-label','ابزارهای تجهیزات');for(const [key,title]of [['excel','ورود و خروج اکسل'],['standards','استانداردها و چک‌لیست'],['errdisabled','بررسی Err-disabled']]){const b=button(title,()=>{generation++;closeRepair();mode=key;draw();},'eq-tab'+(mode===key?' active':''));b.id='eq-tool-'+key;b.setAttribute('aria-pressed',String(mode===key));nav.append(b);}pane.append(nav);const content=el('section','eq-tool-content');pane.append(content);if(mode==='excel')excel(content);else if(mode==='standards')standardsUI(content);else errdisabledUI(content);}
  function mount(main){if(auditResult)try{if(T.audit(getInventory(),standards,nodeId,observed).signature!==auditResult.signature)auditResult=null;}catch(e){auditResult=null;}if(errResult&&errSignature!==JSON.stringify(getInventory()))invalidateErr();pane=el('section','eq-tools-workspace');main.append(pane);draw();}
  function suspend(){generation++;closeRepair();}
  function clear(){generation++;invalidateErr();if(pane)pane.querySelectorAll('textarea').forEach(n=>n.value='');preview=null;importError='';observed='';auditResult=null;nodeId='';auditQuery='';selected.clear();scenarios={};filters={};errResult=null;errSignature='';draft=null;pane=null;mode='excel';page=0;update=false;}
  return Object.freeze({mount,suspend,clear,exportInventory});
 }
 globalThis.FamEquipmentTools=Object.freeze({create});
})();
