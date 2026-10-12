/* FAM local accounts / policy. Browser-only convenience, NOT a security boundary.
   Replace the storage/session adapter with a server API before shared deployment.
   Never put credentials in workbook backups; never trust this policy on a server. */
const Access = (() => {
  const KEY='fam.accounts.v1', SESSION='fam.session.v1', ITERATIONS=120000;
  let db=null, activeId=null, storageError=false;
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const bytes=s=>new Uint8Array(s.match(/../g).map(v=>parseInt(v,16)));
  const username=s=>String(s||'').trim().toLowerCase();
  // These are product capabilities, not access levels. A user's selected
  // capabilities are stored separately from the category data scope.
  const PERMISSION_GROUPS=[
    {title:'مشاهده و جست‌وجو',items:[
      ['view-sheets','مشاهدهٔ شیت‌ها و داشبورد'],['search','جست‌وجو در داده‌ها'],['view-history','مشاهدهٔ تاریخچهٔ تغییرات']]},
    {title:'کار با داده‌ها',items:[
      ['edit-cells','ویرایش مستقیم سلول‌ها'],['save-results','ذخیرهٔ تغییرات نتایج جست‌وجو'],['add-record','افزودن رکورد'],['remove-record','حذف رکورد'],['undo-remove','بازگردانی آخرین حذف']]},
    {title:'ابزارها و عملیات‌ها',items:[
      ['refresh-panel','بازسازی پنل'],['refresh-index','بازسازی ایندکس جست‌وجو'],['import-data','ورود فایل'],['export-xlsx','خروجی Excel'],['backup-server','پشتیبان‌گیری'],['restore-data','بازیابی از پشتیبان'],['empty-data','خالی‌کردن داده‌ها'],['reset-data','بازنشانی کامل داده‌ها']]},
    {title:'مدیریت',items:[
      ['manage-regions','مدیریت مناطق و استان‌ها'],['manage-categories','مدیریت دسته‌بندی‌ها'],['manage-users','مدیریت کاربران و دسترسی‌ها']]}
  ];
  const PERMISSIONS=new Set(PERMISSION_GROUPS.flatMap(group=>group.items.map(([id])=>id)));
  const allPermissions=()=>[...PERMISSIONS];
  const legacyPermissions=role=>{
    if(role===1)return allPermissions();
    if(role===2)return allPermissions().filter(p=>!['save-results','refresh-panel','import-data','empty-data','restore-data','reset-data','manage-users'].includes(p));
    if(role===3)return ['view-sheets','search','view-history','edit-cells','refresh-index','export-xlsx','backup-server'];
    return ['view-sheets','search'];
  };
  const allKnownCategoryIds=()=>[...new Set([...(typeof managedCategories==='function'?managedCategories().map(c=>c.id):[]),'other'])];
  const normalizeAccessUser=u=>{
    const sheets=Array.isArray(u?.sheets)?u.sheets.filter(v=>typeof v==='string'):[];
    const legacy=!Array.isArray(u?.categories)&&!Array.isArray(u?.permissions);
    const inferred=u?.role<=2?allKnownCategoryIds():[...new Set(sheets.map(s=>typeof categoryOf==='function'?categoryOf(s)?.id:null).filter(Boolean))];
    if(u?.role>2&&Array.isArray(u?.regions)&&u.regions.length&&!inferred.includes('provinces'))inferred.push('provinces');
    const supplied=Array.isArray(u?.categories)?u.categories.filter(v=>typeof v==='string'):inferred;
    const regions=legacy&&u?.role<=2&&typeof managedRegions==='function'
      ?managedRegions().filter(r=>r.id!=='unassigned').map(r=>r.id)
      :(Array.isArray(u?.regions)?u.regions.filter(v=>typeof v==='string'):[]);
    return {...u,sheets,regions:[...new Set(regions)],
      categories:[...new Set(supplied.includes('*')?allKnownCategoryIds():supplied)],
      permissions:Array.isArray(u?.permissions)?[...new Set(u.permissions.filter(v=>PERMISSIONS.has(v)))]:legacyPermissions(u?.role)
    };
  };
  function validate(value) {
    if(!value || value.version!==1 || !Array.isArray(value.users) ) throw Error('فایل حساب‌ها معتبر نیست.');
    value={...value,users:value.users.map(normalizeAccessUser)};
    if(!value.users.length)throw Error('حداقل یک مدیر فعال مدیریت کاربران لازم است.');
    const ids=new Set(),names=new Set();
    for(const u of value.users){
      if(!u || typeof u.id!=='string' || ids.has(u.id) || typeof u.username!=='string' || !/^[a-z0-9_.-]{3,40}$/.test(u.username) || names.has(u.username)
        || typeof u.name!=='string' || !u.name.trim() || u.name.length>60 || ![1,2,3,4].includes(u.role) || typeof u.enabled!=='boolean'
        || !/^[a-f0-9]{32}$/.test(u.salt) || !/^[a-f0-9]{64}$/.test(u.hash) || typeof u.revision!=='string'
        || !Array.isArray(u.regions) || !u.regions.every(s=>typeof s==='string') || !Array.isArray(u.sheets) || !u.sheets.every(s=>typeof s==='string')
        || !Array.isArray(u.categories) || !u.categories.every(s=>typeof s==='string') || !Array.isArray(u.permissions) || !u.permissions.every(p=>PERMISSIONS.has(p))) throw Error('فایل حساب‌ها معتبر نیست.');
      ids.add(u.id);names.add(u.username);
    }
    if(!value.users.some(u=>u.enabled&&u.permissions.includes('manage-users')))throw Error('حداقل یک مدیر فعال مدیریت کاربران لازم است.');
    return value;
  }
  function load(){
    try { const raw=localStorage.getItem(KEY);db=raw===null?null:validate(JSON.parse(raw)); }
    catch(e){storageError=true;db=null;}
  }
  function persist(next){
    next={...next,adminPresetVersion:next.adminPresetVersion || db?.adminPresetVersion || 0};
    next=validate(next);
    localStorage.setItem(KEY,JSON.stringify(next)); // quota errors fail before updating live accounts
    db=next;
  }
  function current(){
    const u=db?.users.find(u=>u.id===activeId && u.enabled);
    return u ? {id:u.id,username:u.username,name:u.name,role:u.role,enabled:u.enabled,regions:[...u.regions],sheets:[...u.sheets],categories:[...u.categories],permissions:[...u.permissions]} : null;
  }
  function establish(user){
    const normalized=normalizeAccessUser(user);
    const at=db.users.findIndex(u=>u.id===normalized.id);if(at>=0)db.users[at]=normalized;
    sessionStorage.setItem(SESSION,JSON.stringify({id:normalized.id,revision:normalized.revision}));
    activeId=normalized.id;
    state.user=normalized.name;
    document.documentElement.dataset.role='custom';
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
  const has=(u,permission)=>!!u&&u.permissions.includes(permission);
  const dataPermission=u=>['view-sheets','search','edit-cells','save-results','add-record','remove-record','undo-remove','export-xlsx'].some(p=>has(u,p));
  // Category IDs stay stable when the administrator renames or reassigns a
  // category. Therefore permissions automatically follow the latest category
  // definition without editing every user record. A category ID which has been
  // deleted is deliberately fail-closed: it matches no worksheet.
  function scopeAllowsSheet(u,sheet){
    if(!SheetExists(sheet)||IsSystemSheet(sheet))return false;
    const category=categoryOf(sheet)?.id||'other';
    if(!u.categories.includes(category))return false;
    if(category!=='provinces')return true;
    const p=provinceOf(sheet);
    return !!p&&u.regions.includes(p.region);
  }
  function hasFullDataScope(u){
    const categories=allKnownCategoryIds();
    if(!categories.every(id=>u.categories.includes(id)))return false;
    const regions=managedRegions().filter(r=>r.id!=='unassigned');
    return regions.every(r=>u.regions.includes(r.id));
  }
  function can(operation,sheet){
    const u=current();if(!u)return false;
    if(operation==='own-password')return true;
    const scoped={read:'view-sheets','search-read':'search',manual:'edit-cells','export':'export-xlsx',backup:'backup-server',add:'add-record',remove:'remove-record','save-results':'save-results','view-history':'view-history',undo:'undo-remove'}[operation];
    if(scoped&&sheet!==undefined)return has(u,scoped)&&scopeAllowsSheet(u,sheet);
    if(operation==='read')return has(u,'view-sheets');
    if(operation==='search-read')return has(u,'search');
    if(operation==='data-access')return dataPermission(u);
    const capability={
      users:'manage-users',admin:'manage-system',source:'source-code',manual:'edit-cells',export:'export-xlsx',backup:'backup-server',
      'view-sheets':'view-sheets','refresh-index':'refresh-index',search:'search',workspace:'view-sheets',add:'add-record',remove:'remove-record',undo:'undo-remove',
      'save-results':'save-results','refresh-panel':'refresh-panel',import:'import-data','empty-data':'empty-data',restore:'restore-data',reset:'reset-data',
      'manage-regions':'manage-regions','manage-categories':'manage-categories','view-history':'view-history'}[operation];
    if(['import','refresh-index','empty-data','restore','reset'].includes(operation))return !!capability&&has(u,capability)&&hasFullDataScope(u);
    return capability?has(u,capability):false;
  }
  function requirePermission(operation,sheet){
    if(can(operation,sheet))return true;
    Toast('این عملیات در مجوزهای حساب شما فعال نیست.','warn');return false;
  }
  function macroAllowed(path){
    if(path==='modExportAllModules.ExportAllModules')return can('source');
    const common=['modSearchEngine.SearchRecords','modSearchEngine.OpenSearchResults','modSearchEngine.ClearSearchResults',
      'modUI.ToggleExactMatch','modUI.NavigateToSheet','modNavigator.ShowSheetNavigator','modNavigator.CloseNavigator'];
    if(common.includes(path))return can('search');
    if(path==='modSearchEngine.RefreshSearchIndexCore')return can('refresh-index');
    if(path==='modSearchEngine.SaveChanges')return can('save-results');
    if(path==='modUI.RefreshPanel')return can('refresh-panel');
    if(path==='modAddRecord.StartAddWizard')return can('add');
    if(path==='modRemoveRecord.StartRemoveWizard')return can('remove');
    if(path==='modUndo.UndoLastRemove')return can('undo');
    return can('admin');
  }
  function actionAllowed(node){
    const a=node.dataset.act;
    if(['edit-user','logout'].includes(a))return !!current();
    if(a==='manage-users')return can('users');
    if(['show-vba','download-module'].includes(a))return can('source');
    if(a==='run-macro')return macroAllowed(node.dataset.arg);
    if(a==='run-macro-index')return macroAllowed(node.dataset.mod+'.'+node.dataset.name);
    if(a==='open-file')return can('import');
    if(a==='save-now')return can('save-results');
    if(a==='export-xlsx')return can('export');
    if(a==='backup')return can('backup');
    if(a==='restore')return can('restore');
    if(['reset-empty','reset-all'].includes(a))return can('reset');
    if(a==='manage-regions')return can('manage-regions');
    if(a==='manage-categories')return can('manage-categories');
    if(['open-sheet','nav-sheet','show-more-rows'].includes(a))return can('workspace') && can('read',node.dataset.name);
    if(['go-cp','toggle-sidebar','toggle-fold','province-region','province-section','open-category','set-filter','filter-rows','quick-exact'].includes(a))return can('workspace');
    if(a==='switch-view')return viewAllowed(node.dataset.view);
    if(a==='toggle-quick')return can('workspace') && (node.getAttribute('aria-controls')!=='quick-undo' || can('undo'));
    return can('admin'); // unknown future operations are admin-only, never implicitly granted
  }
  function viewAllowed(view){
    if(view==='panel')return can('data-access');
    if(view==='sheet')return can('view-sheets');
    if(view==='results')return can('search')||can('remove');
    if(view==='log')return can('view-history');
    return can('admin');
  }
  function hideOperations(){
    if(!current())return;
    document.querySelectorAll('[data-act]').forEach(node=>{
      const permitted=actionAllowed(node);
      node.classList.toggle('access-hidden',!permitted);
      if(node.matches('button'))node.setAttribute('aria-disabled',String(!permitted));
    });
    document.querySelectorAll('.tab-btn[data-view]').forEach(node=>node.classList.toggle('access-hidden',!viewAllowed(node.dataset.view)));
    // Do not leave empty add/remove cards behind for accounts that cannot use
    // their only action. The card remains present for permitted roles.
    ['modAddRecord.StartAddWizard','modRemoveRecord.StartRemoveWizard'].forEach(path=>{
      const action=document.querySelector('[data-act="run-macro"][data-arg="'+path+'"]');
      action?.closest('.card')?.classList.toggle('access-hidden',!macroAllowed(path));
    });
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
    const content=el('div',{},el('p',{text:u.name+' — '+u.username+' — دسترسی سفارشی'}));
    if(can('users'))content.appendChild(el('button',{type:'button',class:'btn btn-primary',id:'account-manage',text:'مدیریت کاربران',onclick:()=>{document.querySelector('#modal-overlay button[data-id="1"]')?.click();manageUsers();}}));
    content.appendChild(el('button',{type:'button',class:'btn btn-primary',id:'account-password',text:can('users')?'تغییر رمز عبور من':'ویرایش حساب من (فقط رمز عبور)',onclick:()=>{document.querySelector('#modal-overlay button[data-id="1"]')?.click();editOwnPassword();}}));
    content.appendChild(el('button',{type:'button',class:'btn btn-ghost',id:'account-logout',text:'خروج از حساب',onclick:()=>logout()}));
    ModalBox({title:'حساب کاربری',contentNode:content,buttons:[{id:IDOK,label:'بستن',cls:'ok'}]});
  }
  // No target ID or profile payload is accepted: this path can only replace the
  // credentials of the authenticated owner. Full account edits stay level-1-only.
  function editOwnPassword(){
    if(!requirePermission('own-password'))return;
    const ownerId=current().id, ownerRevision=db.users.find(u=>u.id===ownerId).revision;
    const ov=document.getElementById('modal-overlay'),previous=document.activeElement;
    const box=el('div',{class:'mbox own-password-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'password-title'});
    const form=el('form',{id:'password-form'}),error=el('p',{id:'password-error',role:'alert',class:'category-error'});
    const old=field('رمز عبور فعلی','password-current','password');old.input.autocomplete='current-password';
    const fresh=field('رمز عبور جدید','password-new','password');
    const repeat=field('تکرار رمز عبور جدید','password-confirm','password');
    [old,fresh,repeat].forEach(f=>{f.input.maxLength=128;f.input.dir='ltr';});
    const save=el('button',{type:'submit',id:'password-save',class:'btn btn-primary',text:'ذخیره رمز جدید'});
    let saving=false;
    const close=()=>{
      if(saving)return;
      [old,fresh,repeat].forEach(f=>{f.input.value='';});
      ov.classList.remove('show');clear(ov);if(previous?.isConnected)previous.focus();
    };
    const closeButton=el('button',{type:'button',id:'password-close',class:'btn btn-ghost btn-sm',text:'×','aria-label':'بستن تغییر رمز',onclick:close});
    const cancel=el('button',{type:'button',id:'password-cancel',class:'btn btn-ghost',text:'انصراف',onclick:close});
    form.append(el('div',{class:'c'},el('p',{text:'حساب: '+current().username}),
      el('p',{class:'hint',text:'فقط رمز عبور حساب خودتان تغییر می‌کند. نام کاربری، نام نمایشی و مجوزهای این حساب بدون تغییر می‌مانند.'}),
      old.node,fresh.node,repeat.node,error),el('div',{class:'f'},save,cancel));
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(saving || !requirePermission('own-password'))return;
      const currentPassword=old.input.value,newPassword=fresh.input.value,confirmation=repeat.input.value;
      saving=true;save.disabled=true;cancel.disabled=true;closeButton.disabled=true;error.textContent='';
      [old,fresh,repeat].forEach(f=>{f.input.disabled=true;});
      try{
        if(current()?.id!==ownerId)throw Error('حساب واردشده تغییر کرده است؛ دوباره وارد شوید.');
        if(newPassword!==confirmation)throw Error('تکرار رمز جدید مطابقت ندارد.');
        const stored=validate(JSON.parse(localStorage.getItem(KEY)));
        const owner=stored.users.find(u=>u.id===ownerId&&u.enabled);
        if(!owner || owner.revision!==ownerRevision)throw Error('اطلاعات حساب تغییر کرده است؛ دوباره وارد شوید.');
        if(await hashPassword(currentPassword,owner.salt)!==owner.hash)throw Error('رمز عبور فعلی نادرست است.');
        const replacement=await credential(newPassword);
        // Re-read after PBKDF2 awaits. Do not overwrite a concurrent admin reset,
        // revocation, or unrelated account update with this form's old snapshot.
        const latest=validate(JSON.parse(localStorage.getItem(KEY)));
        const live=latest.users.find(u=>u.id===ownerId&&u.enabled);
        if(!form.isConnected || !can('own-password') || current()?.id!==ownerId || !live || live.revision!==ownerRevision)
          throw Error('اطلاعات حساب تغییر کرده است؛ دوباره وارد شوید.');
        const changed={...live,...replacement,revision:crypto.randomUUID()};
        persist({...latest,users:latest.users.map(u=>u.id===ownerId?changed:u)});
        establish(changed); // keep this tab signed in; other tabs are revoked by storage events
        saving=false;close();Toast('رمز عبور حساب شما تغییر کرد.','ok');
      }catch(err){error.textContent=err.message;}
      finally{saving=false;save.disabled=false;cancel.disabled=false;closeButton.disabled=false;[old,fresh,repeat].forEach(f=>{f.input.disabled=false;});}
    });
    box.append(el('div',{class:'t'},el('span',{id:'password-title',text:'تغییر رمز عبور حساب من'}),closeButton),form);
    box.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){
        const fs=[...box.querySelectorAll('input,button')].filter(n=>!n.disabled&&n.getClientRects().length),first=fs[0],last=fs.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    });
    clear(ov);ov.appendChild(box);ov.classList.add('show');old.input.focus();
  }
  function manageUsers(){
    if(!requirePermission('users'))return;
    const ov=document.getElementById('modal-overlay');const previous=document.activeElement;
    const box=el('div',{class:'mbox category-manager',role:'dialog','aria-modal':'true','aria-labelledby':'users-title'});
    const list=el('div',{class:'category-list','aria-label':'کاربران ذخیره‌شده'}),area=el('div',{class:'category-editor'});
    const summary=el('p',{id:'users-summary',class:'hint'});
    const status=el('p',{id:'users-status',role:'status','aria-live':'polite'});
    // Creation is the default and remains separate from an explicitly selected
    // account. The submitter decides whether to keep editing or start another.
    let selected=null, saving=false;
    const close=()=>{if(saving)return;ov.classList.remove('show');clear(ov);previous?.isConnected&&previous.focus();};
    const button=(text,id,fn)=>el('button',{type:'button',id,class:'btn btn-ghost btn-sm',text,onclick:fn});
    const drawList=()=>{
      summary.textContent=db.users.length.toLocaleString('fa-IR')+' کاربر ذخیره‌شده · '+db.users.filter(u=>u.enabled&&u.permissions.includes('manage-users')).length.toLocaleString('fa-IR')+' مدیر فعال کاربران';
      clear(list);db.users.forEach(u=>{
        const item=button('ویرایش: '+u.name+' ('+u.username+')'+(u.enabled?'':' · غیرفعال'),'user-'+u.id,()=>{
          if(saving)return;selected=u.id;status.textContent='';drawList();drawEditor();
        });
        item.classList.toggle('is-selected',selected===u.id);
        item.setAttribute('aria-pressed',String(selected===u.id));
        list.appendChild(item);
      });
    };
    const drawEditor=()=>{
      clear(area);
      const original=db.users.find(u=>u.id===selected);
      const draft=normalizeAccessUser(original?JSON.parse(JSON.stringify(original)):{id:crypto.randomUUID(),username:'',name:'',role:4,enabled:true,regions:[],sheets:[],categories:[],permissions:[]});
      const form=el('form',{id:'user-form','data-mode':original?'edit':'create','data-user-id':draft.id}),error=el('p',{id:'user-error',role:'alert',class:'category-error'});
      const mode=el('div',{class:'user-editor-mode'},
        el('h3',{id:'user-mode-title',text:original?'ویرایش کاربر: '+original.username:'افزودن کاربر جدید'}),
        el('p',{class:'hint',text:original
          ? 'محدودهٔ داده را ابتدا انتخاب کنید؛ سپس عملیات مجاز این کاربر را تعیین کنید. تغییرات تا زمان ثبت اعمال نمی‌شوند.'
          : 'ابتدا محدودهٔ داده و سپس عملیات مجاز را انتخاب کنید. این فرم یک حساب مستقل می‌سازد.'}));
      const un=field('نام کاربری','user-username','text',draft.username),name=field('نام نمایشی','user-name','text',draft.name);
      const pw=field(original?'رمز جدید (خالی = بدون تغییر)':'رمز عبور','user-password','password');pw.input.required=!original;
      un.input.maxLength=40;name.input.maxLength=60;pw.input.maxLength=128;
      const enabled=el('input',{type:'checkbox',id:'user-enabled',checked:draft.enabled});

      // Scope comes before the operational permissions. Category identifiers—not
      // labels or worksheet names—are persisted; category edits remain dynamic.
      const scopes=el('section',{id:'user-scopes',class:'user-scope-section'},
        el('h4',{text:'۱. محدودهٔ دادهٔ مجاز'}),
        el('p',{class:'hint',text:'عملیات انتخاب‌شده در مرحلهٔ بعد فقط روی این محدوده اجرا می‌شوند. «استان‌ها و شعب» تنها دسته‌ای است که زیرمحدودهٔ منطقه دارد.'}));
      const categories=el('div',{class:'access-scopes category-scope-tree','aria-label':'دسته‌های دادهٔ مجاز'});
      const cs=new Set(draft.categories),rs=new Set(draft.regions);
      const selectable=[...managedCategories(),CAT_OTHER].filter((c,i,a)=>c.id!=='system'&&a.findIndex(x=>x.id===c.id)===i);
      const known=new Set(selectable.map(c=>c.id));
      const stale=[...cs].filter(id=>!known.has(id));
      const regionOptions=managedRegions().filter(r=>r.id!=='unassigned');
      const regionBox=el('div',{class:'access-scopes user-region-scope','aria-label':'مناطق مجاز'});
      const allRegions=el('input',{type:'checkbox',id:'user-all-regions'});
      const syncRegions=()=>{
        const all=regionOptions.length>0&&regionOptions.every(r=>rs.has(r.id));
        allRegions.checked=all;allRegions.indeterminate=!all&&regionOptions.some(r=>rs.has(r.id));
        regionBox.querySelectorAll('input[data-user-region]').forEach(input=>{input.checked=rs.has(input.dataset.userRegion);input.disabled=!cs.has('provinces');});
        allRegions.disabled=!cs.has('provinces')||!regionOptions.length;
        regionBox.classList.toggle('is-disabled',!cs.has('provinces'));
      };
      allRegions.addEventListener('change',()=>{regionOptions.forEach(r=>allRegions.checked?rs.add(r.id):rs.delete(r.id));syncRegions();});
      selectable.forEach(c=>{
        const check=el('input',{type:'checkbox','data-user-category':c.id,checked:cs.has(c.id),onchange:e=>{e.target.checked?cs.add(c.id):cs.delete(c.id);syncRegions();}});
        const row=el('label',{class:'access-check category-scope-row'},check,txt(c.name));
        categories.appendChild(row);
        if(c.id==='provinces'){
          const regions=el('div',{class:'user-region-children'},
            el('label',{class:'access-check region-all'},allRegions,txt('همهٔ مناطق')),
            el('p',{class:'hint',text:'با انتخاب همهٔ مناطق، منطقه‌های فعلی پیکربندی‌شده همگی مجاز می‌شوند.'}),regionBox);
          categories.appendChild(regions);
        }
      });
      regionOptions.forEach(r=>regionBox.appendChild(el('label',{class:'access-check'},el('input',{type:'checkbox','data-user-region':r.id,checked:rs.has(r.id),onchange:e=>{e.target.checked?rs.add(r.id):rs.delete(r.id);syncRegions();}}),txt(r.name))));
      if(!regionOptions.length)regionBox.appendChild(el('p',{class:'hint',text:'منطقه‌ای تعریف نشده است.'}));
      if(stale.length){
        const staleBox=el('div',{class:'category-error'},el('p',{text:'دسترسی به دستهٔ حذف‌شده مسدود است و تا حذف صریح نگه داشته می‌شود: '+stale.join('، ')}));
        staleBox.appendChild(el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'حذف دسترسی‌های حذف‌شده',onclick:()=>{stale.forEach(id=>cs.delete(id));staleBox.remove();}}));
        scopes.appendChild(staleBox);
      }
      scopes.appendChild(categories);syncRegions();

      const permissionSection=el('section',{id:'user-permissions',class:'user-permission-section'},
        el('h4',{text:'۲. عملیات مجاز'}),
        el('p',{class:'hint',text:'هر عملیات فقط در محدودهٔ دادهٔ انتخاب‌شده در بالا اعمال می‌شود. مجوزهای مدیریتی مستقل از داده هستند.'}));
      const ps=new Set(draft.permissions);
      PERMISSION_GROUPS.forEach(group=>{
        const groupBox=el('fieldset',{class:'permission-group'},el('legend',{text:group.title}));
        group.items.forEach(([id,label])=>groupBox.appendChild(el('label',{class:'access-check'},el('input',{type:'checkbox','data-user-permission':id,checked:ps.has(id),onchange:e=>{e.target.checked?ps.add(id):ps.delete(id);}}),txt(label))));
        permissionSection.appendChild(groupBox);
      });
      const save=el('button',{type:'submit',id:'user-save',class:'btn btn-primary',text:'ثبت'});
      const saveAndNew=el('button',{type:'submit',id:'user-save-new',class:'btn btn-cyan',text:'ثبت و ایجاد کاربر جدید'});
      const cancel=el('button',{type:'button',id:'user-cancel',class:'btn btn-ghost',text:'لغو',onclick:close});
      const formActions=el('div',{class:'f user-form-actions'},save,cancel,saveAndNew);
      form.append(mode,un.node,name.node,pw.node,el('label',{class:'access-check'},enabled,txt('حساب فعال است')),scopes,permissionSection,error,formActions);
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(saving || !requirePermission('users'))return;
        const createAnother=e.submitter?.id==='user-save-new';
        saving=true;save.disabled=true;saveAndNew.disabled=true;cancel.disabled=true;error.textContent='';
        try{
          const changed={...draft,username:username(un.input.value),name:name.input.value.trim(),enabled:enabled.checked,
            categories:[...cs],regions:cs.has('provinces')?[...rs]:[],sheets:[],permissions:[...ps],revision:crypto.randomUUID()};
          if(!/^[a-z0-9_.-]{3,40}$/.test(changed.username))throw Error('نام کاربری باید ۳ تا ۴۰ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
          if(!changed.name || changed.name.length>60)throw Error('نام نمایشی باید بین ۱ تا ۶۰ نویسه باشد.');
          if(db.users.some(u=>u.id!==changed.id && u.username===changed.username))throw Error('این نام کاربری قبلاً ثبت شده است.');
          if(pw.input.value)Object.assign(changed,await credential(pw.input.value));
          if(!can('users'))throw Error('مجوز مدیریت کاربران تغییر کرده است.');
          const next={version:1,users:original?db.users.map(u=>u.id===original.id?changed:u):db.users.concat(changed)};
          if(!next.users.some(u=>u.enabled&&u.permissions.includes('manage-users')))throw Error('حداقل یک مدیر فعال مدیریت کاربران لازم است. برای ساخت حساب جداگانه، «کاربر جدید» را بزنید.');
          persist(next);pw.input.value='';
          if(changed.id===activeId){if(!changed.enabled){await logout();return;}establish(changed);}
          selected=createAnother?null:changed.id;
          status.textContent=createAnother
            ? 'کاربر «'+changed.username+'» ذخیره شد. فرم کاربر جدید آماده است.'
            : (original?'تغییرات کاربر «'+changed.username+'» ذخیره شد.':'کاربر «'+changed.username+'» ساخته شد.');
          drawList();drawEditor();updateStatLine();
          if(createAnother)area.querySelector('#user-username').focus();
          Toast(original?'تغییرات کاربر ذخیره شد.':'کاربر جدید ساخته شد.','ok');
        }catch(e){error.textContent=e.message;}finally{saving=false;save.disabled=false;saveAndNew.disabled=false;cancel.disabled=false;}
      });
      area.appendChild(form);
      if(original)area.appendChild(button('حذف کاربر','user-delete',async()=>{
        if(saving || !requirePermission('users'))return;
        if(!confirm('کاربر «'+original.name+'» حذف شود؟ داده‌های شیت‌ها حذف نمی‌شوند.'))return;
        try{
          const next={version:1,users:db.users.filter(u=>u.id!==original.id)};
          if(!next.users.some(u=>u.enabled&&u.permissions.includes('manage-users')))throw Error('حداقل یک مدیر فعال مدیریت کاربران لازم است.');
          persist(next);
          if(original.id===activeId){await logout();return;}selected=null;status.textContent='کاربر حذف شد؛ فرم افزودن کاربر جدید آماده است.';drawList();drawEditor();
        }catch(e){error.textContent=e.message;}
      }));
    };
    box.append(el('div',{class:'t'},el('span',{id:'users-title',text:'مدیریت کاربران محلی'}),button('×','users-close',close)),
      el('div',{class:'c'},el('p',{class:'hint',text:'دارندگان مجوز «مدیریت کاربران و دسترسی‌ها» می‌توانند این بخش را باز کنند. رمزها به صورت متن ذخیره یا نمایش داده نمی‌شوند. تغییرات فرم تا ذخیره اعمال نمی‌شوند. حساب‌ها در پشتیبان دادهٔ اکسل/JSON قرار نمی‌گیرند.'}),
        button('+ کاربر جدید','user-new',()=>{if(saving)return;selected=null;status.textContent='';drawList();drawEditor();area.querySelector('#user-username').focus();}),summary,status,el('div',{class:'category-manager-grid'},list,area)),
      el('div',{class:'f'},button('بستن','users-done',close)));
    box.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){const fs=[...box.querySelectorAll('button,input,select')].filter(e=>!e.disabled&&e.getClientRects().length);const first=fs[0],last=fs.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
    clear(ov);ov.appendChild(box);ov.classList.add('show');drawList();drawEditor();box.querySelector('#user-username').focus();
  }
  // Kept as a harmless compatibility hook for older page shells. The custom
  // permission model uses the normal application views, never a level-specific viewer.
  function renderViewer(){ document.getElementById('access-viewer')?.remove(); }

  window.addEventListener('storage',e=>{
    if((e.key===KEY || e.key===null) && activeId){document.documentElement.classList.add('auth-pending');document.getElementById('access-viewer')?.remove();sessionStorage.removeItem(SESSION);location.reload();}
    // Data/region changes in another tab may change the allowed region of a sheet.
    if(e.key===LS_KEY && current()){document.documentElement.classList.add('auth-pending');document.getElementById('access-viewer')?.remove();location.reload();}
  });
  return Object.freeze({start,current,can,require:requirePermission,macroAllowed,actionAllowed,viewAllowed,hideOperations,accountMenu,editOwnPassword,manageUsers,logout,renderViewer});
})();
