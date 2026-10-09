/* FAM local accounts / policy. Browser-only convenience, NOT a security boundary.
   Replace the storage/session adapter with a server API before shared deployment.
   Never put credentials in workbook backups; never trust this policy on a server. */
const Access = (() => {
  const KEY='fam.accounts.v1', SESSION='fam.session.v1', ITERATIONS=120000;
  let db=null, activeId=null, storageError=false;
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const bytes=s=>new Uint8Array(s.match(/../g).map(v=>parseInt(v,16)));
  const username=s=>String(s||'').trim().toLowerCase();
  function validate(value) {
    if(!value || value.version!==1 || !Array.isArray(value.users) ) throw Error('فایل حساب‌ها معتبر نیست.');
    if(!value.users.length)throw Error('حداقل یک مدیر فعال سطح ۱ لازم است.');
    const ids=new Set(),names=new Set();
    for(const u of value.users){
      if(!u || typeof u.id!=='string' || ids.has(u.id) || typeof u.username!=='string' || !/^[a-z0-9_.-]{3,40}$/.test(u.username) || names.has(u.username)
        || typeof u.name!=='string' || !u.name.trim() || u.name.length>60 || ![1,2,3,4].includes(u.role) || typeof u.enabled!=='boolean'
        || !/^[a-f0-9]{32}$/.test(u.salt) || !/^[a-f0-9]{64}$/.test(u.hash) || typeof u.revision!=='string'
        || !Array.isArray(u.regions) || !u.regions.every(s=>typeof s==='string') || !Array.isArray(u.sheets) || !u.sheets.every(s=>typeof s==='string')) throw Error('فایل حساب‌ها معتبر نیست.');
      ids.add(u.id);names.add(u.username);
    }
    if(!value.users.some(u=>u.enabled&&u.role===1))throw Error('حداقل یک مدیر فعال سطح ۱ لازم است.');
    return value;
  }
  function load(){
    try { const raw=localStorage.getItem(KEY);db=raw===null?null:validate(JSON.parse(raw)); }
    catch(e){storageError=true;db=null;}
  }
  function persist(next){
    next={...next,adminPresetVersion:next.adminPresetVersion || db?.adminPresetVersion || 0};
    validate(next);
    localStorage.setItem(KEY,JSON.stringify(next)); // quota errors fail before updating live accounts
    db=next;
  }
  function current(){
    const u=db?.users.find(u=>u.id===activeId && u.enabled);
    return u ? {id:u.id,username:u.username,name:u.name,role:u.role,enabled:u.enabled,regions:[...u.regions],sheets:[...u.sheets]} : null;
  }
  function establish(user){
    sessionStorage.setItem(SESSION,JSON.stringify({id:user.id,revision:user.revision}));
    activeId=user.id;
    state.user=user.name;
    document.documentElement.dataset.role=String(user.role);
    document.documentElement.classList.remove('auth-pending');
  }
  async function hashPassword(password,salt){
    if(!crypto?.subtle)throw Error('برای ورود از فایل مستقیم یا HTTPS استفاده کنید.');
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:ITERATIONS,hash:'SHA-256'},material,256)));
  }
  async function credential(password){
    if(password.length<4 || password.length>128)throw Error('رمز باید بین ۴ تا ۱۲۸ نویسه باشد؛ رمز طولانی و مستقل انتخاب کنید.');
    const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
    return {salt,hash:await hashPassword(password,salt)};
  }
  function can(operation,sheet){
    const u=current();if(!u)return false;
    if(operation==='users')return u.role===1;
    if(operation==='read'){
      if(!SheetExists(sheet))return false;
      if(u.role<=2)return true;
      if(IsSystemSheet(sheet))return false;
      if(u.role===3)return true;
      if(!u.sheets.includes(sheet))return false;
      const p=provinceOf(sheet);
      return !p || u.regions.includes(p.region);
    }
    if(['admin','manual','export'].includes(operation))return u.role<=2;
    if(['search','add','remove','workspace'].includes(operation))return u.role<=3;
    return false;
  }
  function requirePermission(operation,sheet){
    if(can(operation,sheet))return true;
    Toast('این عملیات برای سطح دسترسی شما مجاز نیست.','warn');return false;
  }
  function macroAllowed(path){
    if(can('admin'))return true;
    if(!can('workspace'))return false;
    return ['modSearchEngine.SearchRecords','modSearchEngine.OpenSearchResults','modSearchEngine.ClearSearchResults',
      'modAddRecord.StartAddWizard','modRemoveRecord.StartRemoveWizard','modUI.ToggleExactMatch',
      'modUI.NavigateToSheet','modNavigator.ShowSheetNavigator','modNavigator.CloseNavigator'].includes(path);
  }
  function actionAllowed(node){
    const a=node.dataset.act;
    if(['edit-user','logout'].includes(a))return !!current();
    if(a==='manage-users')return can('users');
    if(a==='run-macro')return macroAllowed(node.dataset.arg);
    if(a==='run-macro-index')return macroAllowed(node.dataset.mod+'.'+node.dataset.name);
    if(['open-sheet','nav-sheet','show-more-rows'].includes(a))return can('workspace') && can('read',node.dataset.name);
    if(['go-cp','toggle-sidebar','toggle-fold','province-region','province-section','open-category','set-filter','filter-rows','quick-exact'].includes(a))return can('workspace');
    if(a==='switch-view')return viewAllowed(node.dataset.view);
    if(a==='toggle-quick')return can('workspace') && (node.getAttribute('aria-controls')!=='quick-undo' || can('admin'));
    return can('admin'); // unknown future operations are admin-only, never implicitly granted
  }
  function viewAllowed(view){return can('workspace') && (can('admin') || ['panel','sheet','results'].includes(view));}
  function hideOperations(){
    if(!current())return;
    document.querySelectorAll('[data-act]').forEach(node=>{
      const permitted=actionAllowed(node);
      node.classList.toggle('access-hidden',!permitted);
      if(node.matches('button'))node.setAttribute('aria-disabled',String(!permitted));
    });
    document.querySelectorAll('.tab-btn[data-view]').forEach(node=>node.classList.toggle('access-hidden',!viewAllowed(node.dataset.view)));
  }
  function field(label,id,type='text',value=''){
    const input=el('input',{id,type,class:'inp',value,required:true,autocomplete:type==='password'?'new-password':'off'});
    return {input,node:el('label',{class:'access-field',for:id},el('span',{text:label}),input)};
  }
  async function start(){
    load();
    // Explicit UI-10 migration requested by the owner. Applied once, never on
    // ordinary reload or workbook import. Future administrator changes survive.
    if(!storageError && (!db || db.adminPresetVersion!==1)) {
      try {
        const seed={salt:'2a6bba0bc6555f065ef9ad543f493c29',hash:'23e59c6e32b1fded0f1ae34b5be83b3e72f15efbef1ef8862f8fef03a1f290c8'};
        const users=db?db.users.map(u=>({...u})):[];
        const existing=users.find(u=>u.username==='admin') || users.find(u=>u.enabled&&u.role===1);
        const admin={...(existing||{}),id:existing?.id||crypto.randomUUID(),username:'admin',name:'admin',role:1,enabled:true,
          regions:[],sheets:[],revision:crypto.randomUUID(),...seed};
        persist({version:1,adminPresetVersion:1,users:existing?users.map(u=>u.id===existing.id?admin:u):[...users,admin]});
      } catch(e) { storageError=true; }
    }
    try{
      const session=JSON.parse(sessionStorage.getItem(SESSION)||'null');
      const user=db?.users.find(u=>u.id===session?.id && u.revision===session.revision && u.enabled);
      if(user){establish(user);return Promise.resolve();}
    }catch(e){}
    return new Promise(resolve=>{
      const root=el('div',{id:'auth-screen'}),form=el('form',{class:'access-login','aria-labelledby':'auth-title'});
      const u=field('نام کاربری (حروف انگلیسی)','auth-username','text','');u.input.autocomplete='username';
      const p=field('رمز عبور','auth-password','password');p.input.autocomplete='current-password';
      const error=el('p',{id:'auth-error',role:'alert',class:'category-error'});
      const submit=el('button',{type:'submit',class:'btn btn-primary',id:'auth-submit',text:'ورود'});
      form.append(el('h2',{id:'auth-title',text:'ورود به فام'}),
        el('p',{class:'hint',text:'نسخه محلی HTML — حساب‌ها و داده‌ها در همین مرورگر نگهداری می‌شوند. این محدودیت‌ها جای امنیت سمت سرور را نمی‌گیرند.'}));
      if(storageError){form.append(el('p',{role:'alert',text:'حساب‌های ذخیره‌شده قابل خواندن نیستند یا ذخیره‌سازی مرورگر مسدود است. برای جلوگیری از از‌دست‌رفتن دسترسی، راه‌اندازی مجدد خودکار انجام نمی‌شود. نسخه پشتیبان مرورگر را بررسی کنید.'}));}
      else{
        form.append(u.node,p.node,error,submit);
        form.addEventListener('submit',async e=>{
          e.preventDefault();submit.disabled=true;error.textContent='';
          try{
            let user;
            load();
            if(storageError || !db)throw Error('حساب‌ها قابل خواندن نیستند؛ صفحه را تازه کنید.');
            user=db.users.find(x=>x.username===username(u.input.value)&&x.enabled);
            if(!user || await hashPassword(p.input.value,user.salt)!==user.hash)throw Error('نام کاربری یا رمز عبور نادرست است.');
            establish(user);p.input.value='';root.remove();resolve();
          }catch(err){error.textContent=err.message;p.input.value='';}
          finally{submit.disabled=false;}
        });
      }
      root.appendChild(form);document.body.appendChild(root);u.input.focus();
    });
  }
  async function logout(){
    document.documentElement.classList.add('auth-pending');
    document.getElementById('access-viewer')?.remove();
    clear(document.getElementById('modal-overlay'));document.getElementById('modal-overlay').classList.remove('show');
    try{await flushDeepSave();}finally{sessionStorage.removeItem(SESSION);activeId=null;location.reload();}
  }
  function accountMenu(){
    const u=current();if(!u)return;
    const content=el('div',{},el('p',{text:u.name+' — '+u.username+' — سطح '+u.role}));
    if(can('users'))content.appendChild(el('button',{type:'button',class:'btn btn-primary',id:'account-manage',text:'مدیریت کاربران',onclick:()=>{document.querySelector('#modal-overlay button[data-id="1"]')?.click();manageUsers();}}));
    content.appendChild(el('button',{type:'button',class:'btn btn-ghost',id:'account-logout',text:'خروج از حساب',onclick:()=>logout()}));
    ModalBox({title:'حساب کاربری',contentNode:content,buttons:[{id:IDOK,label:'بستن',cls:'ok'}]});
  }
  function manageUsers(){
    if(!requirePermission('users'))return;
    const ov=document.getElementById('modal-overlay');const previous=document.activeElement;
    const box=el('div',{class:'mbox category-manager',role:'dialog','aria-modal':'true','aria-labelledby':'users-title'});
    const list=el('div',{class:'category-list'}),area=el('div',{class:'category-editor'});
    let selected=current().id;
    const close=()=>{ov.classList.remove('show');clear(ov);previous?.isConnected&&previous.focus();};
    const button=(text,id,fn)=>el('button',{type:'button',id,class:'btn btn-ghost btn-sm',text,onclick:fn});
    const drawList=()=>{
      clear(list);db.users.forEach(u=>list.appendChild(button(u.name+' · سطح '+u.role+(u.enabled?'':' · غیرفعال'),'user-'+u.id,()=>{selected=u.id;drawEditor();})));
    };
    const drawEditor=()=>{
      clear(area);
      const original=db.users.find(u=>u.id===selected);
      const draft=original?JSON.parse(JSON.stringify(original)):{id:crypto.randomUUID(),username:'',name:'',role:3,enabled:true,regions:[],sheets:[]};
      const form=el('form',{id:'user-form'}),error=el('p',{id:'user-error',role:'alert',class:'category-error'});
      const un=field('نام کاربری','user-username','text',draft.username),name=field('نام نمایشی','user-name','text',draft.name);
      const pw=field(original?'رمز جدید (خالی = بدون تغییر)':'رمز عبور','user-password','password');pw.input.required=!original;
      un.input.maxLength=40;name.input.maxLength=60;pw.input.maxLength=128;
      const role=el('select',{id:'user-role',class:'inp'});
      [[1,'سطح ۱ — مدیر کامل و مدیریت کاربران'],[2,'سطح ۲ — همه امکانات به‌جز مدیریت کاربران'],[3,'سطح ۳ — مشاهده، جستجو، درج و حذف'],[4,'سطح ۴ — فقط مشاهده محدوده مجاز']].forEach(([v,t])=>role.appendChild(el('option',{value:String(v),text:t})));
      role.value=String(draft.role);
      const enabled=el('input',{type:'checkbox',id:'user-enabled',checked:draft.enabled});
      const scopes=el('div',{id:'user-scopes'}),rs=new Set(draft.regions),ss=new Set(draft.sheets);
      scopes.append(el('p',{class:'hint',text:'سطح ۴: فقط شیت‌های انتخاب‌شده مجازند. شیت‌های استانی علاوه بر انتخاب شیت، به انتخاب منطقهٔ جاری آن استان هم نیاز دارند. انتخاب خالی یعنی بدون دسترسی؛ انتقال استان به منطقه دیگر ممکن است دسترسی را قطع کند.'}));
      const regions=el('div',{class:'access-scopes','aria-label':'مناطق مجاز'}),sheets=el('div',{class:'access-scopes','aria-label':'بخش‌های مجاز'});
      managedRegions().forEach(r=>regions.appendChild(el('label',{},el('input',{type:'checkbox','data-user-region':r.id,checked:rs.has(r.id),onchange:e=>{e.target.checked?rs.add(r.id):rs.delete(r.id);}}),txt(r.name))));
      WB.order.filter(IsDataSheet).forEach(s=>sheets.appendChild(el('label',{},el('input',{type:'checkbox','data-user-sheet':s,checked:ss.has(s),onchange:e=>{e.target.checked?ss.add(s):ss.delete(s);}}),txt(s))));
      if(!sheets.childElementCount)sheets.appendChild(el('p',{class:'hint',text:'برای انتخاب بخش‌ها، ابتدا دادهٔ اکسل وارد کنید.'}));
      scopes.append(el('h4',{text:'مناطق مجاز'}),regions,el('h4',{text:'بخش‌های مجاز'}),sheets);
      const showScopes=()=>{scopes.hidden=role.value!=='4';};role.addEventListener('change',showScopes);showScopes();
      const save=el('button',{type:'submit',id:'user-save',class:'btn btn-primary',text:'ذخیره کاربر'});
      form.append(un.node,name.node,pw.node,el('label',{for:'user-role',text:'سطح دسترسی'}),role,
        el('label',{class:'access-check'},enabled,txt('حساب فعال است')),scopes,error,save);
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(!requirePermission('users'))return;save.disabled=true;error.textContent='';
        try{
          const changed={...draft,username:username(un.input.value),name:name.input.value.trim(),role:Number(role.value),enabled:enabled.checked,
            regions:[...rs],sheets:[...ss],revision:crypto.randomUUID()};
          if(!/^[a-z0-9_.-]{3,40}$/.test(changed.username))throw Error('نام کاربری باید ۳ تا ۴۰ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
          if(!changed.name || changed.name.length>60)throw Error('نام نمایشی باید بین ۱ تا ۶۰ نویسه باشد.');
          if(db.users.some(u=>u.id!==changed.id && u.username===changed.username))throw Error('این نام کاربری قبلاً ثبت شده است.');
          if(pw.input.value)Object.assign(changed,await credential(pw.input.value));
          if(!can('users'))throw Error('مجوز مدیریت کاربران تغییر کرده است.');
          const next={version:1,users:original?db.users.map(u=>u.id===original.id?changed:u):db.users.concat(changed)};
          persist(next);pw.input.value='';
          if(changed.id===activeId){if(!changed.enabled || changed.role!==1){await logout();return;}establish(changed);}
          selected=changed.id;drawList();drawEditor();updateStatLine();Toast('کاربر ذخیره شد.','ok');
        }catch(e){error.textContent=e.message;}finally{save.disabled=false;}
      });
      area.appendChild(form);
      if(original)area.appendChild(button('حذف کاربر','user-delete',async()=>{
        if(!requirePermission('users'))return;
        if(!confirm('کاربر «'+original.name+'» حذف شود؟ داده‌های شیت‌ها حذف نمی‌شوند.'))return;
        try{persist({version:1,users:db.users.filter(u=>u.id!==original.id)});
          if(original.id===activeId){await logout();return;}selected=db.users[0].id;drawList();drawEditor();
        }catch(e){error.textContent=e.message;}
      }));
    };
    box.append(el('div',{class:'t'},el('span',{id:'users-title',text:'مدیریت کاربران محلی'}),button('×','users-close',close)),
      el('div',{class:'c'},el('p',{class:'hint',text:'فقط سطح ۱ کاربران را مدیریت می‌کند. رمزها به صورت متن ذخیره یا نمایش داده نمی‌شوند. تغییرات فرم تا ذخیره اعمال نمی‌شوند. حساب‌ها در پشتیبان دادهٔ اکسل/JSON قرار نمی‌گیرند.'}),
        button('+ کاربر جدید','user-new',()=>{selected=null;drawEditor();}),el('div',{class:'category-manager-grid'},list,area)),
      el('div',{class:'f'},button('بستن','users-done',close)));
    box.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){const fs=[...box.querySelectorAll('button,input,select')].filter(e=>!e.disabled&&e.getClientRects().length);const first=fs[0],last=fs.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
    clear(ov);ov.appendChild(box);ov.classList.add('show');drawList();drawEditor();box.querySelector('#user-username').focus();
  }
  function renderViewer(){
    if(current()?.role!==4)return;
    let root=document.getElementById('access-viewer');if(!root){root=el('main',{id:'access-viewer'});document.body.appendChild(root);}
    clear(root);
    const account=current();
    root.appendChild(el('header',{class:'access-viewer-head'},el('h2',{text:'بخش‌های مجاز — '+account.name}),el('span',{text:'سطح ۴ · فقط مشاهده'}),
      el('button',{class:'btn btn-ghost',text:'حساب کاربری / خروج',onclick:accountMenu})));
    const visible=WB.order.filter(n=>can('read',n));
    const regions=managedRegions().filter(r=>account.regions.includes(r.id));
    const nav=el('div',{class:'access-viewer-nav'}),choices=el('div',{class:'sheet-grid'}),body=el('div',{id:'viewer-sheet-body'});
    const drawChoices=region=>{
      clear(choices);clear(body);
      const names=visible.filter(n=>region==='all'||(region==='other'?!provinceOf(n):provinceOf(n)?.region===region));
      for(const name of names)choices.appendChild(el('button',{class:'btn btn-ghost','data-viewer-sheet':name,text:name,onclick:()=>{
        if(!can('read',name)){clear(body);return;}
        clear(body);body.appendChild(el('h3',{text:name}));
        // Use the existing merge-aware renderer, then move only its read-only table.
        renderSheetView(name);
        const grid=document.querySelector('#sheet-body .grid-wrap');if(grid)body.appendChild(grid);
        const more=document.querySelector('#sheet-body [data-act="show-more-rows"]');
        if(more)body.appendChild(el('button',{class:'btn btn-ghost',text:'نمایش ردیف‌های بیشتر',onclick:()=>{
          if(!can('read',name))return;state.pageLimit+=500;choices.querySelector('[data-viewer-sheet="'+CSS.escape(name)+'"]')?.click();
        }}));
      }}));
      if(!names.length)choices.appendChild(el('p',{class:'hint',text:'در این محدوده بخشی برای شما مجاز نشده است.'}));
    };
    nav.appendChild(el('button',{class:'btn btn-ghost',text:'همه بخش‌های مجاز',onclick:()=>drawChoices('all')}));
    regions.forEach(r=>nav.appendChild(el('button',{class:'btn btn-ghost','data-viewer-region':r.id,text:r.name,onclick:()=>drawChoices(r.id)})));
    if(visible.some(n=>!provinceOf(n)))nav.appendChild(el('button',{class:'btn btn-ghost',text:'بخش‌های غیر استانی',onclick:()=>drawChoices('other')}));
    root.append(nav,choices,body);drawChoices('all');
  }
  window.addEventListener('storage',e=>{
    if((e.key===KEY || e.key===null) && activeId){document.documentElement.classList.add('auth-pending');document.getElementById('access-viewer')?.remove();sessionStorage.removeItem(SESSION);location.reload();}
    // Data/region changes in another tab may change the allowed region of a sheet.
    if(e.key===LS_KEY && current()?.role===4){document.documentElement.classList.add('auth-pending');document.getElementById('access-viewer')?.remove();location.reload();}
  });
  return Object.freeze({start,current,can,require:requirePermission,macroAllowed,actionAllowed,viewAllowed,hideOperations,accountMenu,manageUsers,logout,renderViewer});
})();
