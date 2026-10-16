/* Offline tools controller. Only inventory + non-secret checklist definitions persist.
   Observed configuration, scenarios, reports and file previews stay in closure RAM. */
(()=>{
 'use strict';const M=FamEquipmentInventory,T=FamEquipmentToolsModel,E=FamEquipmentExcel,KEY='fam.equipment.standards.v1';
 function create({getInventory,saveInventory,isAuthorized}){
  let pane=null,mode='excel',generation=0,preview=null,importError='',createCategories=false,update=false,standards={version:1,items:[]},standardIssue='';
  let draft=null,nodeId='',observed='',auditResult=null,auditQuery='',selected=new Set(),scenarios={},filters={},page=0,errResult=null,errSignature='',errAt='';
  try{const raw=localStorage.getItem(KEY);if(raw!==null)standards=T.validateStandards(JSON.parse(raw));}catch(e){standardIssue='استانداردهای ذخیره‌شده قابل خواندن نیست؛ برای حفظ اطلاعات ویرایش غیرفعال است.';}
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,handler,cls='btn btn-ghost btn-sm')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',handler);return b;};
  const tools=(...items)=>{const row=el('div','eq-tools');row.append(...items);return row;};
  const note=(text,warning=false)=>el('div','eq-notice'+(warning?' warning':''),text);
  const find=(key,id)=>getInventory().catalog[key].find(x=>x.id===id),name=(key,id)=>find(key,id)?.name||'حذف‌شده / نامشخص';
  const id=()=>crypto.randomUUID(),allowed=()=>{if(!isAuthorized())throw Error('دوباره وارد مدیریت تجهیزات شوید.');};
  function select(parent,label,items,value,handler,key,all='انتخاب کنید…'){
   const wrap=el('label','eq-field',label),s=el('select','inp');if(key)s.id=key;const empty=el('option','',all);empty.value='';s.append(empty);
   for(const item of items){const o=el('option','',item.name);o.value=item.id;s.append(o);}if(value&&!items.some(x=>x.id===value)){const o=el('option','','دستهٔ قبلی حذف شده؛ اصلاح کنید');o.value=value;s.append(o);}s.value=value||'';
   if(handler)s.addEventListener('change',()=>handler(s.value));wrap.append(s);parent.append(wrap);return s;
  }
  function input(parent,label,value,handler,key,max=80){const wrap=el('label','eq-field',label),n=el('input','inp');n.value=value||'';n.maxLength=max;if(key)n.id=key;n.addEventListener('input',()=>handler(n.value));wrap.append(n);parent.append(wrap);return n;}
  function check(parent,text,value,handler,key){const wrap=el('label','eq-tool-checkbox'),n=el('input');n.type='checkbox';n.checked=value;if(key)n.id=key;n.addEventListener('change',()=>handler(n.checked));wrap.append(n,el('span','',text));parent.append(wrap);return n;}
  function table(parent,headers,rows){const wrap=el('div','eq-table-wrap'),table=el('table','eq-table'),head=el('thead'),hr=el('tr');headers.forEach(x=>hr.append(el('th','',x)));head.append(hr);table.append(head);const body=el('tbody');rows.forEach(cells=>{const row=el('tr');cells.forEach(text=>row.append(el('td','',String(text??''))));body.append(row);});table.append(body);wrap.append(table);parent.append(wrap);return body;}
  function download(sheets,filename){allowed();const book=XLSX.utils.book_new();for(const [title,rows]of sheets){const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=(rows[0]||[]).map((_,i)=>({wch:i===0?28:24}));XLSX.utils.book_append_sheet(book,sheet,title);}XLSX.writeFile(book,filename,{bookType:'xlsx',compression:true});}
  function exportInventory(){allowed();E.download(getInventory(),{includeNodes:true});}
  function template(){allowed();E.download(getInventory());}
  function excel(parent){
   parent.append(note('ورود اکسل واقعیِ مشخصات تجهیزات؛ بدون تغییر فایل‌های پایگاه داده. ثبت فقط پس از پیش‌نمایش و تأیید انجام می‌شود. رمز یا کانفیگ در فایل تجهیزات نگذارید.'));
   const templateButton=button('دریافت فرم ورود از دسته‌های فعلی',template);templateButton.id='eq-download-template';parent.append(tools(templateButton,button('خروجی همهٔ تجهیزات',exportInventory)));
   parent.append(note('قالب زنده است: هر بار از آخرین دسته‌ها و نام‌های همین برنامه ساخته می‌شود؛ مدل و محل در اکسل منوی وابسته دارند. ابتدا فرم به‌روز بگیرید، ردیف‌ها را تکمیل و سپس همین‌جا وارد کنید. بعد از تغییر دسته‌ها، فایل قبلی قابل ورود نیست.'));
   const options=el('div','eq-tool-options');check(options,'ساخت دسته‌های جدید از نام‌های فایل',createCategories,value=>{createCategories=value;preview=null;draw();},'eq-import-create');check(options,'به‌روزرسانی نودهای موجود بر اساس شناسه / IP',update,value=>{update=value;preview=null;draw();},'eq-import-update');parent.append(options);
   const label=el('label','eq-field','انتخاب فایل xlsx تجهیزات'),file=el('input','inp');file.type='file';file.accept='.xlsx';file.id='eq-inventory-file';label.append(file);parent.append(label);
   file.addEventListener('change',async()=>{
    const f=file.files[0],token=++generation;preview=null;importError='';if(!f)return;
    try{allowed();if(!/\.xlsx$/i.test(f.name)||f.size>5*1024*1024)throw Error('فقط xlsx با اندازهٔ حداکثر ۵ مگابایت مجاز است.');
     const buffer=await f.arrayBuffer();if(token!==generation||!isAuthorized())return;
     const imported=E.read(buffer);T.assertCatalogSnapshot(getInventory(),imported.snapshot);const rows=imported.rows;
     preview=T.prepareImport(getInventory(),rows,{createCategories,update});
    }catch(e){importError=e.message;}if(token===generation&&isAuthorized())draw();
   });
   if(importError)parent.append(note(importError,true));
   if(preview){const p=preview;parent.append(note(p.counts.added+' نود جدید · '+p.counts.updated+' ویرایش · '+p.counts.categories+' دستهٔ جدید · '+p.errors.length+' خطا — هنوز ثبت نشده است.',!!p.errors.length));
    if(p.errors.length){table(parent,['ردیف','خطا'],p.errors.slice(0,100).map(x=>[x.row||'کل فایل',x.message]));if(p.errors.length>100)parent.append(note('فقط ۱۰۰ خطای اول نمایش داده شده؛ همهٔ خطاها باید برطرف شوند.'));}
    else{const body=table(parent,['نام','IP','نوع / مدل','منطقه / محل'],p.next.nodes.slice(0,25).map(n=>[n.name,n.host,p.next.catalog.models.find(x=>x.id===n.modelId)?.name||'',p.next.catalog.sites.find(x=>x.id===n.siteId)?.name||'']));body.closest('table').setAttribute('aria-label','پیش‌نمایش موجودی پس از ورود');parent.append(note('پیش‌نمایش ۲۵ نود اولِ کل موجودیِ پس از ثبت؛ هیچ نودی خارج از فایل حذف نمی‌شود.'));
     const apply=button('تأیید و ثبت ورود',()=>{try{allowed();if(p.base!==JSON.stringify(M.validate(getInventory())))throw Error('موجودی تغییر کرده؛ فایل را دوباره پیش‌نمایش کنید.');if(!confirm('ورود '+p.counts.added+' نود جدید و ویرایش '+p.counts.updated+' نود ثبت شود؟'))return;saveInventory(p.next);preview=null;importError='ورود با موفقیت ثبت شد؛ دسته‌بندی‌ها خودکار به‌روز شدند.';draw();}catch(e){importError=e.name==='QuotaExceededError'?'فضای مرورگر کافی نیست؛ هیچ ردیفی ثبت نشد.':e.message;draw();}},'btn btn-primary');apply.id='eq-import-apply';parent.append(apply);}
   }
  }
  function newDraft(){return {id:id(),name:'',modelId:'',siteKindId:null,siteId:null,checks:[{id:id(),name:'',operator:'exact-line',pattern:''}]};}
  function saveStandards(next){allowed();if(standardIssue)throw Error(standardIssue);const clean=T.validateStandards(next);try{localStorage.setItem(KEY,JSON.stringify(clean));}catch(e){throw Error('استاندارد ذخیره نشد؛ فضای مرورگر را بررسی کنید.');}standards=clean;auditResult=null;}
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
   const error=el('div','eq-error');error.setAttribute('role','alert');const submit=el('button','btn btn-primary','ذخیره استاندارد');submit.type='submit';submit.id='eq-standard-save';submit.disabled=!!standardIssue;editor.append(add,error,tools(submit,button('فرم استاندارد جدید',()=>{draft=newDraft();draw();})));
   editor.addEventListener('submit',event=>{event.preventDefault();try{const model=find('models',s.modelId);if(!model||!['router','switch'].includes(find('types',model.typeId)?.kind)||s.siteKindId&&!find('siteKinds',s.siteKindId)||s.siteId&&find('sites',s.siteId)?.siteKindId!==s.siteKindId)throw Error('مدل و محل معتبر و سازگار انتخاب کنید.');const next=structuredClone(standards),at=next.items.findIndex(x=>x.id===s.id);if(at<0)next.items.push(s);else next.items[at]=s;saveStandards(next);draft=newDraft();draw();}catch(e){error.textContent=e.message;}});
   list.append(el('h4','','استانداردهای تعریف‌شده'));
   for(const policy of standards.items){const row=el('article','eq-tool-policy');row.append(el('strong','',policy.name),el('p','eq-muted',name('models',policy.modelId)+' · '+(policy.siteId?name('sites',policy.siteId):policy.siteKindId?name('siteKinds',policy.siteKindId):'همهٔ محل‌ها')+' · '+policy.checks.length+' آیتم'));
    const edit=button('ویرایش',()=>{draft=structuredClone(policy);draw();}),remove=button('حذف',()=>{if(!confirm('فقط استاندارد «'+policy.name+'» حذف شود؟ نودها حذف نمی‌شوند.'))return;try{saveStandards({version:1,items:standards.items.filter(x=>x.id!==policy.id)});draft=newDraft();draw();}catch(e){alert(e.message);}});edit.disabled=remove.disabled=!!standardIssue;edit.setAttribute('aria-label','ویرایش استاندارد '+policy.name);remove.setAttribute('aria-label','حذف استاندارد '+policy.name);row.append(tools(edit,remove));list.append(row);}
   if(!standards.items.length)list.append(note('استانداردی تعریف نشده؛ نتیجهٔ بررسی بدون استاندارد «تأییدشده» محسوب نمی‌شود.'));grid.append(editor,list);parent.append(grid);
   const audit=el('section','eq-tool-card');audit.append(el('h4','','بررسی نود و خروجی چک‌لیست'));
   const nodeSelectBox=el('div');input(audit,'جست‌وجوی نام یا IP نود',auditQuery,v=>{auditQuery=v;drawNodeOptions();},'eq-audit-search');
   function drawNodeOptions(){nodeSelectBox.replaceChildren();const nodes=getInventory().nodes.filter(n=>n.id===nodeId||[n.name,n.host].some(x=>x.toLowerCase().includes(auditQuery.toLowerCase())));select(nodeSelectBox,'نود مورد بررسی',nodes.map(n=>({id:n.id,name:n.name+' · '+n.host})),nodeId,v=>{nodeId=v;observed='';auditResult=null;draw();},'eq-audit-node');}
   drawNodeOptions();audit.append(nodeSelectBox);if(nodeId){const n=getInventory().nodes.find(n=>n.id===nodeId);if(n)audit.append(note(name('models',n.modelId)+' · '+name('sites',n.siteId)));}
   const observedLabel=el('label','eq-field','کانفیگ ساختگی همین نود (فقط RAM)'),text=el('textarea','inp eq-tool-observed');text.id='eq-audit-observed';text.dir='ltr';text.maxLength=12000;text.spellcheck=false;text.autocomplete='off';text.value=observed;observedLabel.append(text);audit.append(observedLabel);
   const report=el('div');report.id='eq-audit-report';const exportButton=button('خروجی اکسل چک‌لیست',()=>{try{allowed();if(!auditResult)throw Error('ابتدا بررسی را اجرا کنید.');const live=T.audit(getInventory(),standards,nodeId,observed);if(live.signature!==auditResult.signature)throw Error('نود یا استاندارد تغییر کرده؛ بررسی را دوباره اجرا کنید.');download([['چک‌لیست',[
    ['منبع','نود','IP','استاندارد','آیتم','نتیجه','زمان'],...auditResult.rows.map(r=>[auditResult.source,auditResult.node.name,auditResult.node.host,r.standard,r.check,auditLabel(r.status),auditResult.at])]]],'FAM-Checklist-DEMO.xlsx');}catch(e){report.replaceChildren(note(e.message,true));}});exportButton.id='eq-audit-export';exportButton.disabled=!auditResult?.rows.length;
   text.addEventListener('input',()=>{observed=text.value;auditResult=null;report.replaceChildren();exportButton.disabled=true;});
   const run=button('بررسی چک‌لیست آزمایشی',()=>{try{allowed();auditResult={...T.audit(getInventory(),standards,nodeId,observed),at:new Date().toISOString()};draw();}catch(e){report.replaceChildren(note(e.message,true));}},'btn btn-primary');run.id='eq-audit-run';run.disabled=!!standardIssue;
   audit.append(tools(run,exportButton),report);if(auditResult){report.append(note(auditResult.source+'؛ نتیجه، وضعیت واقعی دستگاه نیست.'));if(!auditResult.rows.length)report.append(note('استاندارد متناسب با مدل و محل این نود تعریف نشده است.',true));else table(report,['استاندارد','آیتم','نتیجه'],auditResult.rows.map(r=>[r.standard,r.check,auditLabel(r.status)]));}parent.append(audit);
  }
  const auditLabel=status=>({ok:'منطبق (آزمایشی)',fail:'نامنطبق (آزمایشی)',unknown:'نامشخص / بررسی‌نشده'})[status];
  const errLabel=scenario=>({unknown:'سناریو تعیین نشده',clean:'پاک — نمایشی',errdisabled:'Err-disabled — نمایشی',auth:'احراز هویت ناموفق — نمایشی',timeout:'پایان زمان — نمایشی',connection:'خطای اتصال — نمایشی'})[scenario];
  const scenarioItems=['clean','errdisabled','auth','timeout','connection'].map(x=>({id:x,name:errLabel(x)}));
  function errdisabledUI(parent){
   parent.append(note('فقط سوئیچ‌ها بر اساس الگوی نوع تجهیز (switch)، نه نام آن‌ها. بررسی فعلاً سناریوی نمایشی است؛ انتخاب‌نکردن سناریو هرگز به معنی وضعیت پاک نیست. هیچ بازیابی یا فرمان واقعی اجرا نمی‌شود.',true));
   const bar=el('div','eq-filters');for(const [field,key,title]of [['typeId','types','نوع سوئیچ'],['modelId','models','مدل'],['regionId','regions','منطقه'],['siteId','sites','محل']]){
    let items=getInventory().catalog[key];if(key==='types')items=items.filter(x=>x.kind==='switch');if(key==='models')items=items.filter(x=>find('types',x.typeId)?.kind==='switch'&&(!filters.typeId||x.typeId===filters.typeId));
    select(bar,title,items,filters[field],v=>{if(v)filters[field]=v;else delete filters[field];if(field==='typeId')delete filters.modelId;page=0;draw();},'eq-err-filter-'+field,'همه');
   }parent.append(bar);
   const nodes=T.switches(getInventory(),filters),maxPage=Math.max(0,Math.ceil(nodes.length/25)-1);page=Math.min(page,maxPage);
   parent.append(note(nodes.length+' سوئیچ در این فیلتر · '+selected.size+' سوئیچ انتخاب‌شده در همهٔ گروه‌ها'));
   const selectionBar=el('div','eq-tools'),allSelected=nodes.length>0&&nodes.every(n=>selected.has(n.id));
   const group=check(selectionBar,'تیک همهٔ سوئیچ‌های این دسته',allSelected,value=>{nodes.forEach(n=>value?selected.add(n.id):selected.delete(n.id));errResult=null;draw();},'eq-err-group-toggle');group.disabled=!nodes.length;group.indeterminate=!allSelected&&nodes.some(n=>selected.has(n.id));
   selectionBar.append(button('پاک‌کردن انتخاب‌ها',()=>{selected.clear();errResult=null;draw();}));parent.append(selectionBar);
   const bulk=el('div','eq-tool-options');let bulkScenario='';select(bulk,'سناریوی ساختگی برای انتخاب‌شده‌ها',scenarioItems,'',v=>bulkScenario=v,'eq-err-bulk','انتخاب سناریو');bulk.append(button('اعمال سناریو',()=>{if(!bulkScenario)return;selected.forEach(id=>scenarios[id]=bulkScenario);errResult=null;draw();}));parent.append(bulk);
   const list=el('div','eq-tool-switch-list');for(const n of nodes.slice(page*25,page*25+25)){const row=el('div','eq-tool-switch');check(row,n.name+' · '+n.host,selected.has(n.id),v=>{v?selected.add(n.id):selected.delete(n.id);errResult=null;draw();},'eq-err-node-'+n.id);row.append(el('span','eq-muted',name('models',n.modelId)+' · '+name('regions',n.regionId)));select(row,'سناریوی این سوئیچ',scenarioItems,scenarios[n.id],v=>{scenarios[n.id]=v||'unknown';errResult=null;draw();},'eq-err-scenario-'+n.id,'بررسی نشده');list.append(row);}parent.append(list);
   if(nodes.length>25){const prev=button('قبلی',()=>{page--;draw();}),next=button('بعدی',()=>{page++;draw();});prev.disabled=page===0;next.disabled=page===maxPage;parent.append(tools(prev,el('span','eq-muted','صفحه '+(page+1)+' از '+(maxPage+1)),next));}
   const report=el('div');report.id='eq-err-report';const run=button('بررسی سوئیچ‌های انتخاب‌شده (نمایشی)',()=>{try{allowed();if(!selected.size)throw Error('حداقل یک سوئیچ انتخاب کنید.');if(!confirm('بررسی نمایشی '+selected.size+' سوئیچ انتخاب‌شده در همهٔ دسته‌ها انجام شود؟ هیچ اتصالی برقرار نمی‌شود.'))return;errResult=T.simulateErr(getInventory(),[...selected],scenarios);errSignature=JSON.stringify(getInventory());errAt=new Date().toISOString();draw();}catch(e){report.replaceChildren(note(e.message,true));}},'btn btn-primary');run.id='eq-err-run';
   const exportButton=button('خروجی اکسل Err-disabled',()=>{try{allowed();if(!errResult||errSignature!==JSON.stringify(getInventory()))throw Error('موجودی تغییر کرده؛ دوباره بررسی کنید.');download([['Err-disabled',[
    ['منبع','نود','IP','مدل','نتیجه','پورت ساختگی','زمان'],...errResult.map(r=>[r.source,r.node.name,r.node.host,name('models',r.node.modelId),errLabel(r.scenario),r.port,errAt])]]],'FAM-Errdisabled-DEMO.xlsx');}catch(e){report.replaceChildren(note(e.message,true));}});exportButton.id='eq-err-export';exportButton.disabled=!errResult;parent.append(tools(run,exportButton),report);
   if(errResult){report.append(note('نتایج فقط از سناریوی صریح انتخاب‌شده ساخته شده‌اند، نه بررسی دستگاه واقعی.'));table(report,['سوئیچ','IP','نتیجهٔ نمایشی','پورت ساختگی'],errResult.map(r=>[r.node.name,r.node.host,errLabel(r.scenario),r.port]));}
  }
  function draw(){if(!pane)return;pane.replaceChildren();const nav=el('nav','eq-tabs');nav.setAttribute('aria-label','ابزارهای تجهیزات');for(const [key,title]of [['excel','ورود و خروج اکسل'],['standards','استانداردها و چک‌لیست'],['errdisabled','بررسی Err-disabled']]){const b=button(title,()=>{generation++;mode=key;draw();},'eq-tab'+(mode===key?' active':''));b.id='eq-tool-'+key;b.setAttribute('aria-pressed',String(mode===key));nav.append(b);}pane.append(nav);const content=el('section','eq-tool-content');pane.append(content);if(mode==='excel')excel(content);else if(mode==='standards')standardsUI(content);else errdisabledUI(content);}
  function mount(main){if(auditResult)try{if(T.audit(getInventory(),standards,nodeId,observed).signature!==auditResult.signature)auditResult=null;}catch(e){auditResult=null;}if(errResult&&errSignature!==JSON.stringify(getInventory()))errResult=null;pane=el('section','eq-tools-workspace');main.append(pane);draw();}
  function suspend(){generation++;}
  function clear(){generation++;if(pane)pane.querySelectorAll('textarea').forEach(n=>n.value='');preview=null;importError='';observed='';auditResult=null;nodeId='';auditQuery='';selected.clear();scenarios={};filters={};errResult=null;errSignature='';draft=null;pane=null;mode='excel';page=0;createCategories=update=false;}
  return Object.freeze({mount,suspend,clear,exportInventory});
 }
 globalThis.FamEquipmentTools=Object.freeze({create});
})();
