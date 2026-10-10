/* Studio presentation layer. All data actions still use the existing permission gates. */
(function(){
  const q=s=>document.querySelector(s);
  const make=(tag,attrs,...children)=>el(tag,attrs,...children);
  const top=q('#topbar');
  const brand=q('#sidebar .brand').cloneNode(true);
  brand.className='studio-brand';
  brand.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
  top.prepend(brand);
  const nav=make('nav',{class:'studio-nav','aria-label':'ناوبری اصلی'});
  [['panel','میزکار','01'],['sheet','کتابخانهٔ داده','02'],['results','نتایج جستجو','03'],['log','تاریخچه','04'],['macros','ابزارها','05']].forEach(([view,label,num])=>{
    nav.append(make('button',{type:'button',class:'studio-nav-item tab-btn'+(view==='panel'?' active':''),'data-act':'switch-view','data-view':view},make('span',{class:'studio-nav-index',text:num}),make('span',{text:label})));
  });
  top.append(nav);
  q('#global-search').placeholder='جستجو در داده‌های شبکه…';
  const content=q('#view-panel>.content'),hero=q('#view-panel .hero');
  hero.querySelector('.hero-net')?.remove();
  hero.classList.add('studio-intro');
  hero.querySelector('.hero-txt').insertBefore(make('h2',{class:'studio-title',text:'داده‌های شبکه، منظم و در دسترس.'}),hero.querySelector('h1'));
  const introAction=make('div',{class:'studio-intro-action'},make('span',{class:'studio-edition',dir:'ltr',text:'FAM / NETWORK STUDIO'}),make('button',{type:'button',class:'btn btn-primary','data-act':'open-file',text:'+ ورود فایل داده'}));
  hero.append(introAction);
  const work=make('div',{class:'studio-workspace'}),main=make('div',{class:'studio-main-column'}),rail=make('aside',{class:'studio-context','aria-label':'دسترسی و فعالیت‌های اخیر'});
  hero.after(work);work.append(main,rail);
  const ops=q('#fold-ops').closest('.dashboard-section');
  ops.classList.add('studio-workbench');main.append(ops);
  const opHead=ops.querySelector(':scope>.card-head');
  opHead.querySelector('h3').textContent='میز عملیات';
  const opTablist=make('div',{class:'studio-operation-tabs',role:'tablist','aria-label':'نوع عملیات'});
  const panels=[...q('#fold-ops .grid-add').children];
  const names=[['search','جستجوی داده','01'],['add','افزودن رکورد','02'],['remove','حذف و بازگردانی','03']];
  function selectTab(index,focus=false){
    [...opTablist.children].forEach((tab,i)=>{
      tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;
      panels[i].hidden=i!==index;
    });
    const help=q('.studio-workbench-help');
    if(help)help.textContent=['جستجو با دکمهٔ جستجو یا کلید Enter انجام می‌شود.','فرم ورود رکورد پس از انتخاب بخش مقصد باز می‌شود.','پیش از حذف، رکوردهای انتخاب‌شده را بررسی کنید.'][index];
    if(focus)opTablist.children[index].focus();
  }
  names.forEach(([name,label,num],i)=>{
    panels[i].id='studio-panel-'+name;panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby','studio-tab-'+name);
    const button=make('button',{type:'button',id:'studio-tab-'+name,role:'tab','aria-controls':panels[i].id},make('span',{text:num}),make('b',{text:label}));
    button.addEventListener('click',()=>selectTab(i));
    button.addEventListener('keydown',event=>{
      const next=event.key==='ArrowLeft'?(i+1)%3:event.key==='ArrowRight'?(i+2)%3:event.key==='Home'?0:event.key==='End'?2:null;
      if(next!==null){event.preventDefault();selectTab(next,true);}
    });opTablist.append(button);
  });
  q('#fold-ops>.fold-inner').prepend(opTablist);selectTab(0);
  const helper=make('div',{class:'studio-workbench-foot'},make('span',{class:'studio-key',text:'↵'}),make('span',{class:'studio-workbench-help',text:'جستجو با دکمهٔ جستجو یا کلید Enter انجام می‌شود.'}),make('span',{class:'studio-local',text:'ذخیره‌سازی محلی'}));
  q('#fold-ops>.fold-inner').append(helper);
  helper.append(q('#save-indicator'));
  const cats=q('#fold-cats').closest('.dashboard-section');cats.classList.add('studio-library');main.append(cats);
  cats.querySelector('h3').textContent='کتابخانهٔ شبکه';
  const direct=q('#fold-nav').closest('.dashboard-section');direct.classList.add('studio-direct');rail.append(direct);
  direct.querySelector('h3').textContent='رفتن به یک بخش';
  const status=q('#fold-status').closest('.dashboard-section');status.classList.add('studio-activity');rail.append(status);
  status.querySelector('h3').textContent='رد فعالیت‌ها';
  const tools=q('#fold-tools').closest('.dashboard-section');tools.classList.add('studio-toolbox');content.append(tools);
  tools.querySelector('h3').textContent='جعبه‌ابزار';
  const note=make('div',{class:'studio-note'},make('span',{class:'studio-note-icon',text:'↗'}),make('h3',{text:'یک محیط، همهٔ عملیات'}),make('p',{text:'از کتابخانه وارد بخش موردنظر شوید؛ داده‌ها را مرور کنید و تغییرات را در تاریخچه دنبال کنید.'}),make('button',{type:'button',class:'btn btn-ghost','data-act':'switch-view','data-view':'sheet',text:'باز کردن کتابخانه ←'}));
  rail.prepend(note);
  content.append(make('footer',{class:'studio-footer'},make('span',{text:'اداره‌ی ارتباطات و شبکه · فام'}),make('span',{dir:'ltr',text:'NETWORK STUDIO / LOCAL WORKSPACE'})));
  status.querySelector('.legend-strip')?.remove();
  // Master/detail library: navigate in the right pane; keep the grid in sight.
  const browser=make('div',{class:'studio-data-browser'}),catalog=q('#sheet-catalog'),grid=q('#sheet-body');
  catalog.before(browser);browser.append(catalog,grid);
  const legend=q('#view-results .legend-strip');
  legend.textContent='نتایج منطبق با جستجو · ویرایش داده‌ها فقط برای سطح ۱ و ۲ · تغییرات را با دکمهٔ ذخیره ثبت کنید.';
  const labels={'SAVE CHANGES':'ذخیره تغییرات','OPEN RESULTS':'مشاهده نتایج','CLEAR RESULTS':'پاک‌کردن نتایج','CLEAR':'پاک‌کردن نتایج','REFRESH PANEL':'بازخوانی میزکار','REFRESH INDEX':'بازسازی ایندکس','IMPORT FILE':'ورود فایل','EMPTY DATA':'تخلیه داده‌ها'};
  document.querySelectorAll('.tool-tile span,#view-results .head-actions .btn').forEach(node=>{
    const label=labels[node.textContent.trim()];if(label)node.textContent=label;
  });
  // Enter on the search field is the existing supported search action.
  // No data is loaded and no account/storage keys are changed here.
})();
