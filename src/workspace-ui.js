/* Workspace: a new information hierarchy over the unchanged Grid/data engine. */
(function(){
  const $=s=>document.querySelector(s),make=(tag,attrs,...children)=>el(tag,attrs,...children);
  const paths={user:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',home:'M3 10 12 3l9 7v11H3zM9 21v-8h6v8',table:'M3 4h18v16H3zM3 10h18M9 4v16',layers:'m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',tools:'m4 4 16 16M4 20l6-6M14 10l6-6',chevron:'m8 10 4 4 4-4',menu:'M4 6h16M4 12h16M4 18h16',density:'M4 5h16M4 10h16M4 15h16M4 20h16',plus:'M12 5v14M5 12h14'};
  const ico=name=>sEl('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},sEl('path',{d:paths[name]||paths.table}));
  const rail=$('.grid-rail'),top=$('#topbar'),nav=$('.grid-global-nav');
  const side=make('aside',{class:'ws-sidebar',id:'ws-sidebar','aria-label':'ناوبری فضای کاری'});
  const logo=$('.grid-brand .brand-logo').cloneNode(true);
  side.append(make('div',{class:'ws-wordmark'},logo,make('div',{},make('b',{text:'فام'}),make('span',{text:'فضای داده'})),make('span',{class:'ws-edition',text:'WORKSPACE'})));
  const identity=make('div',{class:'ws-identity'},make('span',{class:'ws-identity-icon'},ico('layers')),make('div',{},make('b',{text:'شبکه و زیرساخت'}),make('small',{text:'اداره‌ی ارتباطات و شبکه'})));
  side.append(identity,make('div',{class:'ws-nav-label',text:'فضای کاری'}),nav);
  ['table','layers','search','clock','tools'].forEach((glyph,i)=>nav.children[i].prepend(ico(glyph)));
  const search=make('button',{type:'button',class:'ws-search-shortcut','aria-label':'جستجو در تمام داده‌ها'},ico('search'),make('span',{text:'جستجوی سراسری'}),make('kbd',{text:'/'}));
  function focusSearch(){document.documentElement.classList.add('ws-search-open');$('#global-search').focus();}
  search.addEventListener('click',focusSearch);side.insertBefore(search,nav);
  side.append(rail);$('#layout').prepend(side);
  const account=$('#stat-line');account.classList.add('ws-account');
  account.prepend(make('span',{class:'ws-account-avatar','aria-hidden':'true'},ico('user')));
  account.append(make('small',{text:'حساب کاربری'}));side.append(account);
  $('.grid-small-tag').textContent='';$('.grid-rail-heading b').textContent='جدول‌های شما';
  rail.querySelector('[data-act="manage-categories"]').prepend(ico('plus'));
  $('.grid-rail-note small').textContent='روی این مرورگر · بدون همگام‌سازی سروری';
  const tabs=make('div',{class:'ws-view-tabs','aria-label':'انتخاب نمای داده'});
  rail.querySelectorAll('.grid-view-btn').forEach((b,i)=>{if(i<2)tabs.append(b);});
  rail.querySelectorAll('.grid-rail-divider,.grid-rail-heading').forEach((node,i)=>{if(i>0)node.remove();});
  const shell=$('.grid-data-main'),toolbar=$('.grid-toolbar');shell.prepend(tabs);
  const viewTools=make('div',{class:'ws-view-tools'},make('span',{class:'ws-local-label',text:'تنظیم نمایش'}));tabs.append(viewTools);
  const density=make('button',{type:'button',id:'ws-density',class:'ws-density','aria-pressed':'false',title:'تغییر فاصلهٔ ردیف‌ها'},ico('density'),make('span',{text:'فشرده'}));
  viewTools.append(density);
  let compact=false;try{compact=localStorage.getItem('fam.workspace.compact')==='1';}catch(_){}
  function applyDensity(){document.documentElement.classList.toggle('ws-compact',compact);density.setAttribute('aria-pressed',String(compact));density.querySelector('span').textContent=compact?'راحت':'فشرده';}
  density.addEventListener('click',()=>{compact=!compact;applyDensity();try{localStorage.setItem('fam.workspace.compact',compact?'1':'0');}catch(_){}});applyDensity();
  const catbar=$('#cat-bar');shell.before(catbar);$('.grid-body').classList.add('ws-canvas');
  const head=$('.grid-base-head');head.prepend(make('div',{class:'ws-breadcrumb'},make('span',{text:'فضای کاری'}),make('span',{text:'/'}),make('span',{text:'پایگاه دادهٔ شبکه'})));
  const add=$('#grid-add-record');add.classList.add('ws-new-record');add.querySelector('span').textContent='رکورد جدید';head.append(add);
  head.querySelector('.grid-import span').textContent='ورود فایل';
  const hint=make('span',{class:'ws-table-caption',text:'برای مشاهده یا ویرایش جزئیات، شمارهٔ هر ردیف را انتخاب کنید.'});shell.append(hint);
  $('.grid-view-label').remove();
  $('#sheet-filter').placeholder='جستجو در این جدول…';
  const filterLabel=make('span',{class:'ws-filter-label',text:'ردیف‌ها'});toolbar.prepend(filterLabel);
  $('#global-search').placeholder='جستجو در همهٔ داده‌ها…';
  const closeSearch=make('button',{type:'button',class:'ws-search-close','aria-label':'بستن جستجو',text:'×'});
  closeSearch.addEventListener('click',()=>document.documentElement.classList.remove('ws-search-open'));
  top.querySelector('.top-search').append(closeSearch);
  const originalMenu=top.querySelector('.burger');originalMenu.title='منوی ابزارهای کامل';originalMenu.setAttribute('aria-label','منوی ابزارهای کامل');
  originalMenu.append(make('span',{class:'ws-advanced-label',text:'ابزارهای پیشرفته'}));
  const mobileMedia=matchMedia('(max-width:760px)');
  function placeAccount(){if(mobileMedia.matches){top.append(account);side.append(originalMenu);}else{side.append(account);top.append(originalMenu);}side.inert=mobileMedia.matches&&!document.documentElement.classList.contains('ws-side-open');}
  mobileMedia.addEventListener('change',placeAccount);placeAccount();
  const mobile=make('button',{type:'button',class:'ws-mobile-toggle','aria-controls':'ws-sidebar','aria-expanded':'false'},ico('menu'),make('span',{text:'بخش‌ها'}));top.prepend(mobile);
  const scrim=make('button',{type:'button',class:'ws-scrim','aria-label':'بستن فهرست بخش‌ها',tabIndex:-1});$('#layout').append(scrim);
  function toggleSide(open){document.documentElement.classList.toggle('ws-side-open',open);mobile.setAttribute('aria-expanded',String(open));side.inert=mobileMedia.matches&&!open;if(!open)mobile.focus();}
  mobile.addEventListener('click',()=>toggleSide(!document.documentElement.classList.contains('ws-side-open')));scrim.addEventListener('click',()=>toggleSide(false));
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&Access.can('workspace')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest('input,textarea,select,[contenteditable="true"],dialog')&&!$('#auth-screen')&&!document.querySelector('dialog[open]')&&!$('#modal-overlay')?.classList.contains('show')){e.preventDefault();focusSearch();}
    if(e.key==='Escape')document.documentElement.classList.remove('ws-search-open');
    if(e.key==='Escape'&&document.documentElement.classList.contains('ws-side-open')){toggleSide(false);mobile.focus();}
  });
  // Empty state is an illustration, not imported or fabricated workbook data.
  const welcome=$('.grid-welcome');welcome.querySelector('h2').textContent='جای همهٔ داده‌ها، همین‌جاست.';
  welcome.querySelector('.grid-welcome-eyebrow').textContent='از یک فایل شروع کنید';
  welcome.querySelector('p').textContent='اطلاعات شعب و تجهیزات را وارد کنید؛ در یک جدول مرتب ببینید، جستجو کنید و جزئیات را کنار دستتان ویرایش کنید.';
  const art=welcome.querySelector('.grid-welcome-art');art.replaceChildren();art.classList.add('ws-empty-art');
  art.append(make('div',{class:'ws-art-header'},make('i',{}),make('i',{}),make('i',{})));
  for(let r=0;r<3;r++)art.append(make('div',{class:'ws-art-row'},make('i',{}),make('i',{}),make('i',{})));
  $('#grid-demo').classList.add('ws-demo');
  // Viewer-only users keep the original isolated permitted-data surface.
  function markRole(){document.documentElement.classList.toggle('ws-viewer-only',!Access.can('workspace'));}
  document.addEventListener('fam:grid-ready',markRole);
})();
