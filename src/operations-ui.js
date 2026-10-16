/* Light theme layout only; original DOM nodes and form state are retained. */
(function(){
  const hero=document.querySelector('#view-panel .hero');
  const heading=el('h2',{class:'operations-heading operations-only',text:'میزکار مدیریت داده'});
  hero.querySelector('.hero-txt').insertBefore(heading,hero.querySelector('h1'));
  const intro=el('div',{class:'operations-intro-actions operations-only'},
    el('span',{class:'operations-version',text:'تم ۲ / میزکار روشن',dir:'auto'}),
    el('button',{type:'button',class:'btn btn-primary','data-act':'open-file',text:'ورود فایل داده'}),
    el('button',{type:'button',class:'btn btn-ghost',id:'operations-demo',text:'آزمایش با دادهٔ نمونه'}));
  hero.appendChild(intro);
  const nav=el('nav',{class:'operations-nav operations-only','aria-label':'صفحه‌های اصلی'});
  [['panel','میزکار'],['sheet','مرور داده‌ها'],['results','نتایج جستجو'],['log','تاریخچه']].forEach(([view,label])=>{
    nav.appendChild(el('button',{type:'button',class:'btn','data-act':'switch-view','data-view':view,text:label}));
  });
  hero.after(nav);
  const ops=document.getElementById('fold-ops').closest('.dashboard-section');
  const originalPosition=document.createComment('Original operations position');
  ops.before(originalPosition);
  window.FamOperationsLayout=light=>{
    if(light)nav.after(ops);else originalPosition.after(ops);
  };
  window.FamOperationsLayout(window.FamTheme?.current()==='light');
  document.getElementById('operations-demo').addEventListener('click',()=>{
    if(!Access.require('admin'))return;
    if(WB.order.some(IsDataSheet)){
      Toast('دادهٔ نمونه فقط در محیط خالی وارد می‌شود؛ اطلاعات موجود شما جایگزین نشد.','warn');return;
    }
    const headers=['شاخص','نام شعبه','IP LAN','نوع ارتباط','وضعیت'];
    const provinces=['تهران','فارس','خراسان رضوی'];
    const sheets={};
    provinces.forEach((name,p)=>{
      sheets[name]={rows:[headers,...Array.from({length:12},(_,i)=>[
        'DEMO-'+(p+1)+'-'+String(i+1).padStart(2,'0'),
        'شعبهٔ نمونه '+name+' '+(i+1),
        '192.0.2.'+(p*20+i+1),i%2?'فیبر نوری':'MPLS','آزمایشی'
      ])],merges:[]};
    });
    if(importValidatedSheets(provinces,sheets,'دادهٔ نمونهٔ آزمایشی.xlsx',true)){
      Toast('۳۶ ردیف نمونه وارد شد؛ این اطلاعات واقعی شعب نیستند.','ok');
    }
  });
  // No automatic opening/closing of the menu, and no change to stored accounts.
})();
