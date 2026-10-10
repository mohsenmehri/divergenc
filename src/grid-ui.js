/* Data-first UI. Shared workbook, account policy and transaction engine remain authoritative. */
(function(){
  const $=s=>document.querySelector(s),E=(tag,a,...children)=>el(tag,a,...children);
  const paths={table:'M3 4h18v16H3zM3 9h18M8 9v11',cards:'M3 3h7v8H3zM14 3h7v8h-7zM3 15h7v6H3zM14 15h7v6h-7z',plus:'M12 5v14M5 12h14',filter:'M4 6h16M7 12h10M10 18h4',sort:'M8 4v16m-4-4 4 4 4-4M15 5h5M15 10h4M15 15h3',folder:'M3 6h6l2 3h10v11H3z',arrow:'M8 5l7 7-7 7',record:'M4 4h16v16H4zM8 8h8M8 12h8M8 16h4'};
  const icon=name=>sEl('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},sEl('path',{d:paths[name]||paths.table}));
  const btn=(text,attrs={},glyph)=>E('button',{type:'button',class:'btn btn-ghost',...attrs},...(glyph?[icon(glyph)]:[]),E('span',{text}));
  const top=$('#topbar'),brand=$('#sidebar .brand').cloneNode(true);brand.className='grid-brand';brand.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));top.prepend(brand);
  const nav=E('nav',{class:'grid-global-nav','aria-label':'صفحه‌های فضای کاری'});
  [['sheet','داده‌ها'],['panel','عملیات'],['results','نتایج'],['log','تاریخچه'],['macros','ابزارها']].forEach(([view,text])=>nav.append(btn(text,{class:'grid-global-tab tab-btn','data-act':'switch-view','data-view':view})));
  top.append(nav);$('#global-search').placeholder='جستجو در تمام داده‌ها…';
  const title=$('#view-sheet .view-head');title.classList.add('grid-base-head');
  title.querySelector('.title-ico').replaceChildren(icon('table'));
  title.querySelector('.title-ico').classList.add('grid-base-icon');
  title.append(btn('ورود داده',{'data-act':'open-file',class:'btn btn-primary grid-import'},'plus'));
  const catbar=$('#cat-bar');catbar.classList.add('grid-category-tabs');title.after(catbar);
  const content=$('#view-sheet>.content');content.classList.add('grid-body');
  const rail=E('aside',{class:'grid-rail','aria-label':'بخش‌ها و نماها'}),main=E('div',{class:'grid-data-main'});content.prepend(rail,main);
  rail.append(E('div',{class:'grid-rail-heading'},E('b',{text:'بخش‌های من'}),E('span',{class:'grid-small-tag',text:'TABLES'})));
  const sheetSearch=E('input',{class:'inp grid-sheet-search',type:'search',placeholder:'پیدا کردن بخش…','aria-label':'پیدا کردن بخش'}),sheetList=E('div',{class:'grid-sheet-list'});
  rail.append(sheetSearch,sheetList);
  const manage=$('#view-sheet [data-act="manage-categories"]');manage.textContent='مدیریت دسته‌بندی‌ها';rail.append(manage);
  rail.append(E('div',{class:'grid-rail-divider'}),E('div',{class:'grid-rail-heading'},E('b',{text:'نماهای داده'})));
  let mode='table',raw=false,railKey='',sheetKey='';
  const tableMode=btn('نمای جدولی',{class:'grid-view-btn active','aria-pressed':'true'},'table'),cardMode=btn('نمای کارت‌ها',{class:'grid-view-btn','aria-pressed':'false'},'cards');rail.append(tableMode,cardMode);
  const catalogToggle=btn('استان‌ها و تنظیمات',{class:'grid-view-btn','aria-expanded':'false'},'folder');rail.append(catalogToggle);
  const railNote=E('div',{class:'grid-rail-note'},E('span',{class:'grid-note-dot'}),E('span',{text:'فضای کاری محلی'}),E('small',{text:'داده‌ها در همین مرورگر ذخیره می‌شوند.'}));rail.append(railNote);
  const catalog=$('#sheet-catalog');catalog.classList.add('grid-catalog');catalog.hidden=true;rail.append(catalog);
  catalogToggle.addEventListener('click',()=>{catalog.hidden=!catalog.hidden;catalogToggle.setAttribute('aria-expanded',String(!catalog.hidden));});
  const toolbar=E('div',{class:'grid-toolbar'}),viewLabel=E('span',{class:'grid-view-label'},icon('table'),E('b',{text:'نمای جدولی'}));
  const filter=$('.sheet-filter-group');filter.classList.add('grid-filter');filter.querySelector('input').placeholder='فیلتر ردیف‌های نمای فعلی…';filter.querySelector('input').setAttribute('aria-label','فیلتر ردیف‌های نمای فعلی');filter.querySelector('button').replaceChildren(icon('filter'),E('span',{text:'فیلتر'}));
  const sortBtn=btn('مرتب‌سازی',{id:'grid-sort-toggle','aria-expanded':'false'},'sort');
  const rawToggle=E('input',{type:'checkbox',id:'grid-raw'}),rawLabel=E('label',{class:'grid-raw-label'},rawToggle,E('span',{text:'نمای خام اکسل'}));
  const more=E('details',{class:'grid-more'},E('summary',{'aria-label':'ابزارهای بخش',text:'•••'}),$('.sheet-data-actions'));
  toolbar.append(viewLabel,filter,sortBtn,rawLabel,more);main.append(toolbar);
  const sortField=E('select',{id:'grid-sort-field',class:'inp','aria-label':'ستون مرتب‌سازی'}),sortDirection=E('select',{id:'grid-sort-direction',class:'inp','aria-label':'جهت مرتب‌سازی'},E('option',{value:'asc',text:'صعودی ↑'}),E('option',{value:'desc',text:'نزولی ↓'}));
  const sortApply=btn('اعمال',{id:'grid-sort-apply',class:'btn btn-primary'}),sortReset=btn('ترتیب اصلی',{id:'grid-sort-reset'});
  const sortbar=E('div',{class:'grid-sortbar',hidden:true},E('span',{text:'مرتب‌سازی ردیف‌های بارگذاری‌شده'}),sortField,sortDirection,sortApply,sortReset);main.append(sortbar);
  sortBtn.addEventListener('click',()=>{sortbar.hidden=!sortbar.hidden;sortBtn.setAttribute('aria-expanded',String(!sortbar.hidden));});
  const tableHost=$('#sheet-body'),gallery=E('div',{id:'grid-gallery',hidden:true}),welcome=E('div',{class:'grid-welcome'});
  main.append(welcome,tableHost,gallery);
  const add=btn('افزودن رکورد',{id:'grid-add-record',class:'btn grid-add-row'},'plus'),footer=E('div',{class:'grid-table-footer'},E('span',{id:'grid-row-count'}),E('span',{class:'grid-footer-hint',text:'برای جزئیات، شمارهٔ ردیف را باز کنید.'}),$('#save-indicator'));
  main.append(add,footer);
  welcome.append(E('div',{class:'grid-welcome-art','aria-hidden':'true'},icon('table')),E('span',{class:'grid-welcome-eyebrow',text:'یک فضای مرتب برای تمام داده‌های شما'}),E('h2',{text:'اولین جدول را به فضای کارتان بیاورید.'}),E('p',{text:'فایل اکسل یا CSV را وارد کنید؛ بخش‌ها، جستجو و ویرایش رکوردها در یک فضای کاری کنار هم قرار می‌گیرند.'}),E('div',{class:'grid-welcome-actions'},btn('ورود فایل داده',{'data-act':'open-file',class:'btn btn-primary'},'plus'),btn('دیدن دادهٔ نمونه',{id:'grid-demo'})),E('small',{text:'نمونه‌ها آزمایشی‌اند و هیچ اطلاعات موجودی را جایگزین نمی‌کنند.'}));
  $('#view-panel .hero h1').before(E('h2',{class:'grid-operations-title',text:'عملیات و مدیریت داده'}));
  // Original operational controls remain available; the starting view is now data.
  $('#view-panel .hero').classList.add('grid-operations-intro');
  $('#view-panel .hero-net')?.remove();
  function recordRows(){return [...tableHost.querySelectorAll('tbody tr')].filter(tr=>+tr.dataset.r>1&&!rowIsEmpty(WB.sheets[state.currentSheet],+tr.dataset.r));}
  function refreshRail(){
    if(!Access.can('workspace'))return;
    const names=WB.order.filter(n=>IsDataSheet(n)&&Access.can('read',n)&&(state.catFilter==='all'||!state.catFilter||categoryOf(n).id===state.catFilter));
    const key=JSON.stringify([names,state.currentSheet,state.catFilter,sheetSearch.value]);
    if(key!==railKey){railKey=key;sheetList.replaceChildren();
      names.filter(n=>NormalizeText(n).includes(NormalizeText(sheetSearch.value))).forEach((name,i)=>{
        const row=btn(name,{class:'grid-sheet-item'+(state.currentSheet===name?' active':''),'data-act':'open-sheet','data-name':name,title:name},'table');
        row.style.setProperty('--sheet-color',['#7569d6','#4ca58f','#df9659','#639dc4','#bb80c3'][i%5]);sheetList.append(row);
      });
      if(!sheetList.children.length)sheetList.append(E('p',{class:'grid-no-sheets',text:names.length?'بخشی با این نام یافت نشد.':'هنوز بخشی در این دسته نیست.'}));
    }
    const hasSheet=!!WB.sheets[state.currentSheet]&&Access.can('read',state.currentSheet);
    welcome.hidden=hasSheet;tableHost.hidden=!hasSheet||mode!=='table';gallery.hidden=!hasSheet||mode!=='cards';
    add.hidden=!hasSheet||!Access.can('add');
    $('#grid-demo').hidden=!Access.can('admin');
    if(!hasSheet){$('#grid-row-count').textContent='بدون جدول انتخاب‌شده';gallery.replaceChildren();tableHost.replaceChildren();}
  }
  function updateCount(){
    const sh=WB.sheets[state.currentSheet];if(!sh)return;
    const rows=recordRows(),visible=rows.filter(tr=>tr.style.display!=='none');
    $('#grid-row-count').textContent=visible.length.toLocaleString('fa-IR')+' رکورد در نما · '+Math.max(0,countRows(state.currentSheet)-1).toLocaleString('fa-IR')+' رکورد در بخش';
  }
  function drawGallery(){
    gallery.replaceChildren();const sh=WB.sheets[state.currentSheet];if(!sh)return;
    recordRows().filter(tr=>tr.style.display!=='none').forEach(tr=>{
      const row=+tr.dataset.r,values=sh.rows[row-1]||[];
      const card=E('button',{type:'button',class:'grid-record-card','aria-label':'جزئیات رکورد '+(row-1)},E('div',{class:'grid-card-band'},icon('record')),E('small',{text:'رکورد '+(row-1)}),E('h3',{text:String(values[1]||values[0]||'بدون عنوان')}));
      for(let c=0;c<Math.min(values.length,4);c++)card.append(E('div',{class:'grid-card-field'},E('span',{text:String(sh.rows[0]?.[c]||colLetter(c+1))}),E('b',{text:String(values[c]??'—')})));
      card.addEventListener('click',()=>openRecord(state.currentSheet,row));gallery.append(card);
    });
    if(!gallery.children.length)gallery.append(E('p',{class:'grid-no-sheets',text:'رکوردی برای نمایش نیست.'}));
    if(tableHost.querySelector('[data-act="show-more-rows"]'))gallery.append(btn('نمایش رکوردهای بیشتر',{class:'btn btn-ghost grid-gallery-more','data-act':'show-more-rows','data-name':state.currentSheet}));
  }
  function setMode(value){mode=value;tableMode.classList.toggle('active',mode==='table');cardMode.classList.toggle('active',mode==='cards');tableMode.setAttribute('aria-pressed',String(mode==='table'));cardMode.setAttribute('aria-pressed',String(mode==='cards'));viewLabel.replaceChildren(icon(mode==='table'?'table':'cards'),E('b',{text:mode==='table'?'نمای جدولی':'نمای کارت‌ها'}));refreshRail();if(mode==='cards')drawGallery();}
  tableMode.addEventListener('click',()=>setMode('table'));cardMode.addEventListener('click',()=>setMode('cards'));sheetSearch.addEventListener('input',refreshRail);
  function decorateTable(){
    if(!Access.can('workspace'))return;
    const name=state.currentSheet,sh=WB.sheets[name],table=tableHost.querySelector('table.xl');if(!sh||!table)return;
    const merged=!!sh.merges?.length,showRaw=raw||merged;
    table.classList.toggle('grid-raw-table',showRaw);rawToggle.checked=showRaw;rawToggle.disabled=merged;rawToggle.title=merged?'برای حفظ سلول‌های ادغام‌شده، این بخش در نمای خام نمایش داده می‌شود.':'';
    sortBtn.disabled=merged;sortBtn.title=merged?'مرتب‌سازی سلول‌های ادغام‌شده مجاز نیست.':'فقط ردیف‌های بارگذاری‌شده؛ بدون تغییر ترتیب فایل';
    if(sheetKey!==name){sheetKey=name;sortbar.hidden=true;sortBtn.setAttribute('aria-expanded','false');$('#sheet-filter').value='';}
    const headers=[...table.querySelectorAll('thead th')].slice(1);sortField.replaceChildren();
    headers.forEach((th,i)=>{th.textContent=showRaw?colLetter(i+1):String(sh.rows[0]?.[i]||colLetter(i+1));th.title=String(sh.rows[0]?.[i]||colLetter(i+1));sortField.append(E('option',{value:String(i+1),text:th.textContent}));});
    table.querySelectorAll('tbody tr').forEach(tr=>{
      const row=+tr.dataset.r;tr.classList.toggle('grid-header-row',row===1);tr.classList.toggle('grid-trailing-row',row>sh.rows.length);
      if(row>1&&!rowIsEmpty(sh,row)){
        const open=E('button',{type:'button',class:'grid-row-open','aria-label':'باز کردن رکورد '+(row-1),text:String(row-1)});open.addEventListener('click',()=>openRecord(name,row));tr.querySelector('.rn').replaceChildren(open);
      }
      if(row>1)tr.querySelectorAll('td[data-c]').forEach(td=>{
        function styleCell(){
          const heading=String(WB.sheets[name]?.rows[0]?.[+td.dataset.c-1]||'');
          const status=/وضعیت|status/i.test(heading)&&!!td.textContent.trim();
          td.classList.toggle('grid-status-cell',status);
          if(status){
            const offline=/قطع|غیرفعال|خطا|offline/i.test(td.textContent),pending=/بررسی|pending/i.test(td.textContent);
            td.style.setProperty('--tag-color',offline?'#a83e4d':pending?'#947016':'#21755d');
            td.style.setProperty('--tag-bg',offline?'#fcebee':pending?'#fff5db':'#e9f5ef');
          }
          td.classList.toggle('grid-ip-cell',/IP|آدرس/i.test(heading));
        }
        styleCell();
        if(!td.dataset.gridStyleBound){td.dataset.gridStyleBound='1';td.addEventListener('blur',()=>{styleCell();updateCount();});}
      });
    });
    refreshRail();filterRows();updateCount();if(mode==='cards')drawGallery();
  }
  const render=renderSheetView;renderSheetView=function(...args){const result=render.apply(this,args);decorateTable();return result;};
  const catalogRender=renderSheetCatalog;renderSheetCatalog=function(...args){const result=catalogRender.apply(this,args);refreshRail();return result;};
  const dashRender=renderDashboard;renderDashboard=function(...args){const result=dashRender.apply(this,args);refreshRail();return result;};
  const filterRows=filterSheetRows;filterSheetRows=function(...args){filterRows.apply(this,args);updateCount();if(mode==='cards')drawGallery();};
  rawToggle.addEventListener('change',()=>{raw=rawToggle.checked;decorateTable();filterSheetRows();});
  sortApply.addEventListener('click',()=>{
    const sh=WB.sheets[state.currentSheet];if(!sh||sh.merges?.length)return;
    const index=+sortField.value-1,dir=sortDirection.value==='desc'?-1:1;
    const rows=recordRows();rows.sort((a,b)=>String(sh.rows[+a.dataset.r-1]?.[index]??'').localeCompare(String(sh.rows[+b.dataset.r-1]?.[index]??''),'fa',{numeric:true})*dir||(+a.dataset.r-+b.dataset.r));
    const body=tableHost.querySelector('tbody');rows.forEach(row=>body.appendChild(row));[...body.children].filter(row=>+row.dataset.r>1&&!rows.includes(row)).forEach(row=>body.appendChild(row));if(mode==='cards')drawGallery();
  });
  sortReset.addEventListener('click',()=>{const body=tableHost.querySelector('tbody');if(!body)return;[...body.children].sort((a,b)=>+a.dataset.r-+b.dataset.r).forEach(row=>body.appendChild(row));if(mode==='cards')drawGallery();});
  add.addEventListener('click',()=>{
    if(!Access.require('add')||!state.currentSheet)return;
    state.cp.C16=state.currentSheet;$('#cp-c16').value=state.currentSheet;RunMacro('modAddRecord.StartAddWizard');
  });
  function enterData(){
    if(!Access.can('workspace'))return;switchView('sheet');
    const name=WB.sheets[state.currentSheet]&&Access.can('read',state.currentSheet)?state.currentSheet:WB.order.find(n=>IsDataSheet(n)&&Access.can('read',n));
    if(name)renderSheetView(name);else refreshRail();
  }
  const importer=importValidatedSheets;importValidatedSheets=function(...args){const ok=importer.apply(this,args);if(ok)enterData();return ok;};
  document.addEventListener('fam:grid-ready',enterData);
  $('#grid-demo').addEventListener('click',()=>{
    if(!Access.require('admin'))return;
    if(WB.order.some(IsDataSheet)){Toast('نمونه فقط در محیط خالی وارد می‌شود؛ داده‌های شما تغییر نکرد.','warn');return;}
    const sheets={},headers=['شناسه','نام شعبه / تجهیز','IP LAN','نوع ارتباط','وضعیت','توضیحات'];
    ['تهران','فارس','تجهیزات نمونه'].forEach((name,p)=>{sheets[name]={rows:[headers,...Array.from({length:14},(_,i)=>['DEMO-'+(p+1)+'-'+String(i+1).padStart(2,'0'),'نمونه — '+['شعبه مرکزی','شعبه شمال','شعبه میدان','دفتر پشتیبانی','مرکز ارتباطات','شعبه غرب','شعبه شرق'][i%7],'192.0.2.'+(p*30+i+1),['MPLS','فیبر نوری','VPN'][i%3],['فعال','فعال','در بررسی','فعال','قطع'][i%5],'دادهٔ ساختگی برای آزمایش رابط'])],merges:[]};});
    sheets[ARCHIVE_MAIN]={rows:[headers],merges:[]};
    if(importValidatedSheets(Object.keys(sheets),sheets,'نمونهٔ آزمایشی فام.xlsx',true)){state.catFilter='all';renderSheetCatalog();Toast('۴۲ رکورد ساختگی وارد شد؛ این‌ها اطلاعات واقعی شعب نیستند.','ok');}
  });
  function openRecord(name,row){
    if(!Access.require('read',name)||document.getElementById('grid-record-dialog'))return;
    const sh=WB.sheets[name];if(!sh||!sh.rows[row-1])return;
    const original=JSON.stringify(sh.rows[row-1]),header=JSON.stringify(sh.rows[0]),merges=JSON.stringify(sh.merges||[]),previous=document.activeElement;
    const writable=Access.can('manual')&&!state.lockedSheets[name]&&!IsSystemSheet(name)&&!(sh.merges||[]).some(m=>row>=m.r1&&row<=m.r2);
    const dialog=E('dialog',{id:'grid-record-dialog','aria-labelledby':'grid-record-title'}),form=E('form',{class:'grid-record-form'});
    const close=btn('بستن',{class:'grid-record-close','aria-label':'بستن جزئیات'});close.addEventListener('click',()=>dismiss());
    form.append(E('header',{class:'grid-record-head'},E('span',{class:'grid-record-crumb',text:name+' / رکورد '+(row-1)}),close,E('h2',{id:'grid-record-title',text:String(sh.rows[row-1][1]||sh.rows[row-1][0]||'جزئیات رکورد')}),E('p',{text:writable?'ویرایش جزئیات؛ تغییرات فقط با دکمهٔ ذخیره ثبت می‌شوند.':'نمای فقط‌خواندنی؛ ویرایش این رکورد در این پنل مجاز نیست.'})));
    const fields=E('div',{class:'grid-record-fields'}),inputs=[];
    const columns=Math.min(MAX_DATA_COLS,Math.max(sh.rows[0]?.length||0,sh.rows[row-1].length));
    for(let c=1;c<=columns;c++){
      const input=E('input',{id:'grid-record-'+c,value:String(cellVal(name,row,c,true)??''),readOnly:!writable,'data-col':c});inputs.push(input);
      fields.append(E('label',{for:input.id},E('span',{text:String(sh.rows[0]?.[c-1]||colLetter(c))}),input));
    }
    const error=E('p',{id:'grid-record-error',role:'alert'}),save=btn('ذخیره تغییرات',{type:'submit',id:'grid-record-save',class:'btn btn-primary',disabled:!writable});
    form.append(fields,error,E('footer',{class:'grid-record-foot'},E('span',{text:writable?'سطح دسترسی: ویرایش':'سطح دسترسی: مشاهده'}),save));dialog.append(form);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(!Access.can('manual')||!Access.can('read',name)||state.lockedSheets[name]||IsSystemSheet(name)||!writable){error.textContent='مجوز ویرایش وجود ندارد یا تغییر کرده است.';return;}
      if(WB.sheets[name]!==sh||JSON.stringify(sh.rows[row-1])!==original||JSON.stringify(sh.rows[0])!==header||JSON.stringify(sh.merges||[])!==merges){error.textContent='دادهٔ این رکورد تغییر کرده است؛ پنل را ببندید و دوباره باز کنید.';return;}
      const changes=inputs.map((input,i)=>({c:i+1,value:input.value.trim(),edited:input.value!==String(sh.rows[row-1][i]??'')})).filter(v=>v.edited&&v.value!==String(sh.rows[row-1][v.c-1]??''));
      if(!changes.length){dismiss();return;}
      const ok=withTransactionSync({action:'EDIT',sheet:name},()=>{changes.forEach(v=>setCellVal(name,row,v.c,v.value,true));WriteChangeLog('EDIT',name,String(row),'SUCCESS','Record drawer: '+changes.length+' fields');return true;});
      if(ok){dismiss();if(state.currentSheet===name)renderSheetView(name);Toast('تغییرات رکورد اعمال شد.','ok');}else error.textContent='ثبت تغییرات ناموفق بود؛ داده‌ها بازگردانی شدند.';
    });
    let removed=false;
    function finish(){if(removed)return;removed=true;dialog.remove();if(previous?.isConnected)previous.focus();}
    function dismiss(){dialog.close();finish();}
    dialog.addEventListener('close',finish);
    dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
    document.body.append(dialog);dialog.showModal();
  }
  window.FamGrid={openRecord}; // same permission and stale-write checks for direct calls
})();
