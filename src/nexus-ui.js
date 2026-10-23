/* Nexus: visual command centre using live, permission-scoped workbook data.
   No monitoring feed, backend, synthetic activity or automatic sample import. */
(function(){
  const $=s=>document.querySelector(s),E=(tag,a,...kids)=>el(tag,a,...kids);
  const paths={table:'M3 4h18v16H3zM3 10h18M9 4v16',layers:'m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',clock:'M12 7v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',tools:'m4 4 16 16M4 20l6-6M14 10l6-6',arrow:'m9 5 7 7-7 7M16 12H3',plus:'M12 5v14M5 12h14',rows:'M4 5h16v4H4zM4 15h16v4H4z',columns:'M4 4h6v16H4zM14 4h6v16h-6z',empty:'M3 3h18v18H3zM8 12h8',user:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0'};
  const icon=name=>sEl('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},sEl('path',{d:paths[name]||paths.table}));
  const top=$('#topbar'),nav=$('.grid-global-nav');
  const dock=E('aside',{class:'nx-dock','aria-label':'صفحه‌های سامانه'});
  const mark=E('div',{class:'nx-mark'},$('.grid-brand .brand-logo').cloneNode(true),E('b',{text:'NEXUS'}));
  dock.append(mark,nav,E('div',{class:'nx-dock-foot'},E('i',{}),E('span',{text:'LOCAL'})));$('#layout').prepend(dock);
  ['table','layers','search','clock','tools'].forEach((name,i)=>nav.children[i].prepend(icon(name)));
  top.querySelector('.top-actions')?.classList.add('nx-old-actions');
  const account=$('#stat-line');account.classList.add('nx-account');account.prepend(E('span',{class:'nx-avatar'},icon('user')));
  const searchToggle=E('button',{type:'button',class:'nx-search-toggle','aria-label':'جستجوی سراسری'},icon('search'));
  top.append(searchToggle);
  function focusSearch(){if(!Access.can('workspace'))return;document.documentElement.classList.add('nx-search-open');$('#global-search').focus();}
  searchToggle.addEventListener('click',focusSearch);
  const searchClose=E('button',{type:'button',class:'nx-search-close','aria-label':'بستن جستجو',text:'×'});
  searchClose.addEventListener('click',()=>document.documentElement.classList.remove('nx-search-open'));top.querySelector('.top-search').append(searchClose);
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&Access.can('workspace')&&!e.target.closest('input,textarea,select,[contenteditable="true"],dialog')&&!document.querySelector('dialog[open],#modal-overlay.show')){e.preventDefault();focusSearch();}
    if(e.key==='Escape')document.documentElement.classList.remove('nx-search-open');
  });
  const sheet=$('#view-sheet'),head=$('.grid-base-head'),body=$('.grid-body'),main=$('.grid-data-main'),rail=$('.grid-rail');
  const hero=E('section',{class:'nx-hero','aria-labelledby':'nx-hero-title'});
  const intro=E('div',{class:'nx-hero-copy'},E('div',{class:'nx-eyebrow'},E('span',{text:'FAM / DATA CONTROL CENTER'}),E('i',{})),E('h1',{id:'nx-hero-title',text:'داده‌های شبکه،'},E('em',{text:'در یک نگاه.'})),E('p',{text:'از جزئیات هر شعبه تا تصویر کامل اطلاعات؛ یک مرکز برای مدیریت داده‌های شبکه و زیرساخت.'}));
  const heroActions=E('div',{class:'nx-hero-actions'});heroActions.append(head.querySelector('.grid-import'),E('span',{class:'nx-local-chip'},E('i',{}),E('span',{text:'ذخیره‌سازی محلی'})));intro.append(heroActions);
  const art=E('div',{class:'nx-network-art','aria-hidden':'true'});
  art.innerHTML='<svg viewBox="0 0 400 230" fill="none"><defs><linearGradient id="nx-edge" x1="50" y1="30" x2="380" y2="220" gradientUnits="userSpaceOnUse"><stop stop-color="#6c83ff"/><stop offset="1" stop-color="#41d8c4"/></linearGradient></defs><ellipse cx="215" cy="120" rx="126" ry="87" stroke="#8b9cff" stroke-opacity=".13"/><ellipse cx="215" cy="120" rx="87" ry="59" stroke="#8b9cff" stroke-opacity=".13"/><path d="M72 62 215 119 332 48M215 119l115 70M215 119 97 187M215 119l-7-91M215 119 364 116" stroke="url(#nx-edge)" stroke-opacity=".5"/><path d="M72 62 208 28 332 48 364 116 330 189 97 187Z" stroke="#8097f3" stroke-opacity=".2" stroke-dasharray="3 6"/><rect x="179" y="86" width="72" height="66" rx="18" fill="#4662bd" fill-opacity=".45" stroke="#9aaaff" stroke-opacity=".7"/><path d="M197 103h36v12h-36zM197 125h36v12h-36z" stroke="#c9d4ff" stroke-width="1.5"/><circle cx="226" cy="109" r="2" fill="#77e5d2"/><circle cx="226" cy="131" r="2" fill="#77e5d2"/><g fill="#182754" stroke="#7c96ee"><rect x="53" y="45" width="38" height="34" rx="9"/><rect x="313" y="31" width="38" height="34" rx="9"/><rect x="311" y="172" width="38" height="34" rx="9"/><rect x="78" y="170" width="38" height="34" rx="9"/></g><g stroke="#a4baff" stroke-width="1.5"><path d="M64 56h16v10H64zM72 66v4M68 70h8M324 42h16v10h-16zM332 52v4M328 56h8M322 183h16v10h-16zM330 193v4M326 197h8M89 181h16v10H89zM97 191v4M93 195h8"/></g><circle cx="208" cy="28" r="5" fill="#9d9dff"/><circle cx="364" cy="116" r="5" fill="#6de0cc"/></svg>';
  art.append(E('span',{text:'NETWORK / INFORMATION / CONTROL'}));hero.append(intro,art);
  const stats=E('section',{class:'nx-stats','aria-label':'خلاصهٔ داده‌های نمای فعلی'});
  const metricNodes={};
  [['rows','رکورد در نما','rows','blue'],['fields','ستون داده','columns','violet'],['missing','فیلد خالی','empty','amber'],['tables','جدول در دسترس','layers','teal']].forEach(([id,label,glyph,tone])=>{
    const value=E('strong',{id:'nx-metric-'+id,text:'—'}),note=E('small',{text:'در انتظار انتخاب داده'});
    const card=E('article',{class:'nx-stat nx-'+tone},E('div',{class:'nx-stat-top'},E('span',{text:label}),E('i',{},icon(glyph))),value,note,E('div',{class:'nx-stat-line'}));stats.append(card);metricNodes[id]={value,note};
  });
  sheet.prepend(hero,stats);
  const workspace=E('div',{class:'nx-workspace'}),data=E('section',{class:'nx-data','aria-label':'مدیریت رکوردها'}),insights=E('aside',{class:'nx-insights','aria-label':'شناخت داده‌ها و انتخاب جدول'});
  body.before(workspace);workspace.append(data,insights);data.append(head,$('#cat-bar'),body);
  body.replaceChildren(main);
  head.prepend(E('span',{class:'nx-section-kicker',text:'DATA EXPLORER'}));
  $('#sheet-title').parentElement.classList.add('nx-sheet-heading');
  const picker=E('select',{id:'nx-table-picker',class:'inp','aria-label':'رفتن به جدول'});head.append(picker);
  picker.addEventListener('change',()=>{if(picker.value){renderSheetView(picker.value);saveUIState();}});
  let pickerKey='';
  const add=$('#grid-add-record');add.classList.add('nx-new-record');add.querySelector('span').textContent='رکورد جدید';head.append(add);
  const views=E('div',{class:'nx-view-tabs'});rail.querySelectorAll('.grid-view-btn').forEach((b,i)=>{if(i<2)views.append(b);});
  const density=E('button',{type:'button',id:'nx-density',class:'nx-density','aria-pressed':'false'},icon('rows'),E('span',{text:'نمای فشرده'}));views.append(density);main.prepend(views);
  let compact=false;try{compact=localStorage.getItem('fam.nexus.compact')==='1';}catch(_){}
  function setDensity(){document.documentElement.classList.toggle('nx-compact',compact);density.setAttribute('aria-pressed',String(compact));density.querySelector('span').textContent=compact?'نمای راحت':'نمای فشرده';}
  setDensity();density.addEventListener('click',()=>{compact=!compact;setDensity();try{localStorage.setItem('fam.nexus.compact',compact?'1':'0');}catch(_){}});
  $('.grid-view-label').remove();
  const quality=E('section',{class:'nx-quality'},E('div',{class:'nx-panel-title'},E('h3',{text:'کامل بودن اطلاعات'}),E('span',{text:'DATA QUALITY'})));
  const donut=E('div',{class:'nx-donut',role:'img','aria-label':'هنوز داده‌ای انتخاب نشده است'},E('div',{},E('strong',{id:'nx-quality-value',text:'—'}),E('small',{text:'فیلدهای پرشده'})));
  const legend=E('div',{class:'nx-quality-legend'},E('span',{},E('i',{}),E('span',{text:'پرشده'}),E('b',{id:'nx-filled',text:'—'})),E('span',{},E('i',{}),E('span',{text:'خالی'}),E('b',{id:'nx-empty',text:'—'})));
  quality.append(donut,legend,E('p',{id:'nx-quality-scope',text:'بر اساس ردیف‌های نمای فعلی؛ نه وضعیت زندهٔ شبکه.'}));
  const bars=E('section',{class:'nx-field-panel'},E('div',{class:'nx-panel-title'},E('h3',{text:'پوشش هر ستون'}),icon('columns')),E('div',{id:'nx-field-bars'}));
  insights.append(quality,bars,rail);
  $('.grid-rail-heading b').textContent='کتابخانهٔ داده';$('.grid-small-tag').textContent='TABLES';
  rail.querySelectorAll('.grid-rail-heading').forEach((n,i)=>{if(i>0)n.remove();});
  $('.grid-rail-note small').textContent='بدون همگام‌سازی یا پایش سروری';
  const welcome=$('.grid-welcome');welcome.querySelector('h2').textContent='مرکز دادهٔ شما آماده است.';welcome.querySelector('.grid-welcome-eyebrow').textContent='WORKSPACE / READY';welcome.querySelector('p').textContent='فایل داده را وارد کنید تا خلاصهٔ اطلاعات، نمودار پوشش ستون‌ها و رکوردهای قابل ویرایش، یکجا در دسترس باشند.';
  // A deliberately incomplete, clearly synthetic dataset makes quality summaries
  // demonstrable. Replacing the button removes the older sample handler.
  const oldDemo=$('#grid-demo'),demo=oldDemo.cloneNode(true);oldDemo.replaceWith(demo);
  const heroDemo=E('button',{type:'button',id:'nx-hero-demo',class:'btn btn-ghost',hidden:true},E('span',{text:'دیدن دادهٔ نمونه'}));
  heroDemo.addEventListener('click',()=>demo.click());heroActions.insertBefore(heroDemo,heroActions.querySelector('.nx-local-chip'));
  demo.addEventListener('click',()=>{
    if(!Access.require('admin'))return;
    if(WB.order.some(IsDataSheet)){Toast('نمونه فقط در محیط خالی وارد می‌شود؛ داده‌های شما تغییر نکرد.','warn');return;}
    const sheets={},headers=['شناسه','نام شعبه / تجهیز','IP LAN','نوع ارتباط','وضعیت','توضیحات'];
    ['تهران','فارس','تجهیزات نمونه'].forEach((name,p)=>{sheets[name]={rows:[headers,...Array.from({length:14},(_,i)=>['DEMO-'+(p+1)+'-'+String(i+1).padStart(2,'0'),'نمونه — '+['شعبه مرکزی','شعبه شمال','شعبه میدان','دفتر پشتیبانی','مرکز ارتباطات','شعبه غرب','شعبه شرق'][i%7],[4,9].includes(i)?'':'192.0.2.'+(p*30+i+1),[6,11].includes(i)?'':['MPLS','فیبر نوری','VPN'][i%3],i===7?'':['فعال','فعال','در بررسی','فعال','قطع'][i%5],i%4===3?'':'دادهٔ ساختگی برای آزمایش رابط'])],merges:[]};});
    sheets[ARCHIVE_MAIN]={rows:[headers],merges:[]};
    if(importValidatedSheets(Object.keys(sheets),sheets,'نمونهٔ ساختگی Nexus.xlsx',true)){state.catFilter='all';renderSheetCatalog();Toast('۴۲ رکورد ساختگی با چند فیلد خالی برای آزمایش نمودارها وارد شد.','ok');}
  });
  const importer=importValidatedSheets;importValidatedSheets=function(...args){const result=importer.apply(this,args);if(result)requestAnimationFrame(()=>scrollTo({top:0,behavior:'instant'}));return result;};
  let pending=false;
  const fa=n=>Number(n).toLocaleString('fa-IR');
  function readMetrics(){
    if(!Access.can('workspace'))return null;
    const name=state.currentSheet,sh=WB.sheets[name];
    const tables=WB.order.filter(n=>IsDataSheet(n)&&Access.can('read',n)).length;
    if(!sh||!Access.can('read',name))return {name:'',tables,rows:0,fields:0,filled:0,missing:0,coverage:null,columns:[],merged:false};
    const rows=[...document.querySelectorAll('#sheet-body tbody tr')].filter(tr=>+tr.dataset.r>1&&tr.style.display!=='none'&&!rowIsEmpty(sh,+tr.dataset.r)).map(tr=>sh.rows[+tr.dataset.r-1]||[]);
    const fields=Math.min(MAX_DATA_COLS,Math.max(sh.rows[0]?.length||0,0,...rows.map(r=>r.length)));
    const counts=Array(fields).fill(0);for(const row of rows)for(let c=0;c<fields;c++)if(String(row[c]??'').trim()!=='')counts[c]++;
    const filled=counts.reduce((a,b)=>a+b,0),total=rows.length*fields,merged=!!sh.merges?.length;
    return {name,tables,rows:rows.length,fields,filled,missing:total-filled,coverage:total&&!merged?Math.round(filled/total*100):null,merged,columns:counts.map((count,i)=>({name:String(sh.rows[0]?.[i]||colLetter(i+1)),filled:count,percent:rows.length?Math.round(count/rows.length*100):0}))};
  }
  function refresh(){
    pending=false;const m=readMetrics();
    heroDemo.hidden=!Access.can('admin')||WB.order.some(IsDataSheet);
    const names=Access.can('workspace')?WB.order.filter(n=>IsDataSheet(n)&&Access.can('read',n)):[];
    const key=JSON.stringify([names,state.currentSheet]);
    if(key!==pickerKey){pickerKey=key;picker.replaceChildren(E('option',{value:'',text:'رفتن به جدول…'}),...names.map(name=>E('option',{value:name,text:name})));picker.value=names.includes(state.currentSheet)?state.currentSheet:'';picker.disabled=!names.length;}
    if(!m){stats.hidden=true;quality.hidden=true;bars.hidden=true;return;}
    stats.hidden=false;quality.hidden=false;bars.hidden=false;
    for(const key of ['rows','fields','missing','tables'])metricNodes[key].value.textContent=key==='missing'&&m.merged?'—':fa(m[key]);
    metricNodes.rows.note.textContent='ردیف‌های بارگذاری‌شده و فیلترشده';metricNodes.fields.note.textContent=m.name?'در جدول انتخاب‌شده':'جدولی انتخاب نشده';metricNodes.missing.note.textContent=m.merged?'برای سلول‌های ادغام‌شده محاسبه نمی‌شود':'از فیلدهای همین نما';metricNodes.tables.note.textContent='مطابق دسترسی حساب شما';
    $('#nx-quality-value').textContent=m.coverage===null?'—':fa(m.coverage)+'٪';donut.style.setProperty('--quality',(m.coverage||0)+'%');donut.setAttribute('aria-label',m.coverage===null?'پوشش داده قابل محاسبه نیست':fa(m.coverage)+' درصد فیلدهای نمای فعلی پر شده است');
    $('#nx-filled').textContent=m.merged?'—':fa(m.filled);$('#nx-empty').textContent=m.merged?'—':fa(m.missing);
    $('#nx-quality-scope').textContent=m.merged?'سلول‌های ادغام‌شده: پوشش داده محاسبه نمی‌شود.':'بر اساس '+fa(m.rows)+' ردیف نمای فعلی؛ نه وضعیت زندهٔ شبکه.';
    const host=$('#nx-field-bars');host.replaceChildren();
    if(!m.rows||m.merged){host.append(E('p',{class:'nx-muted',text:m.merged?'برای حفظ معنای سلول‌های ادغام‌شده، نمودار غیرفعال است.':'با انتخاب داده، نمودار ستون‌ها اینجا نمایش داده می‌شود.'}));return;}
    m.columns.slice(0,5).forEach((col,i)=>{
      const line=E('div',{class:'nx-field-bar'},E('div',{},E('span',{text:col.name,title:col.name}),E('b',{text:fa(col.percent)+'٪'})),E('div',{class:'nx-track'},E('i',{style:'width:'+col.percent+'%;--bar-hue:'+['#718aff','#a291f5','#52c6cf','#659cf4','#dfa065'][i]})));
      host.append(line);
    });
    if(m.columns.length>5)host.append(E('small',{class:'nx-muted',text:'پنج ستون اول از '+fa(m.fields)+' ستون'}));
  }
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(refresh);}
  const render=renderSheetView;renderSheetView=function(...args){const result=render.apply(this,args);schedule();return result;};
  const filter=filterSheetRows;filterSheetRows=function(...args){const result=filter.apply(this,args);schedule();return result;};
  const dashboard=renderDashboard;renderDashboard=function(...args){const result=dashboard.apply(this,args);schedule();return result;};
  document.addEventListener('fam:grid-ready',schedule);
  document.addEventListener('focusout',e=>{if(e.target.matches('#sheet-body td[data-c]'))schedule();});
  // Read-only inspection hook for deterministic summary tests. Never writes WB.
  window.FamNexus={metrics:()=>readMetrics()};
})();
