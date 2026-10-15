/* Central accounts: server sessions and permissions; no local credential store. */
const Access = (() => {
  let db={users:[]},activeId=null,usersRevision=0;
  const username=s=>String(s||'').trim().toLowerCase();
  // The central editor intentionally uses the same capability vocabulary and
  // scope controls as the current offline editor. The server validates every
  // capability independently; this client never treats the UI as a boundary.
  const PERMISSION_GROUPS=[
    {title:'مشاهده و جست‌وجو',items:[['view-sheets','مشاهدهٔ شیت‌ها و داشبورد'],['search','جست‌وجو در داده‌ها'],['view-history','مشاهدهٔ تاریخچهٔ تغییرات']]},
    {title:'کار با داده‌ها',items:[['edit-cells','ویرایش مستقیم سلول‌ها'],['save-results','ذخیرهٔ تغییرات نتایج جست‌وجو'],['add-record','افزودن رکورد'],['remove-record','حذف رکورد'],['undo-remove','بازگردانی آخرین حذف']]},
    {title:'ابزارها و عملیات‌ها',items:[['refresh-panel','بازسازی پنل'],['refresh-index','بازسازی ایندکس جست‌وجو'],['import-data','ورود فایل'],['export-xlsx','خروجی Excel'],['backup-server','پشتیبان‌گیری'],['restore-data','بازیابی از پشتیبان'],['empty-data','خالی‌کردن داده‌ها'],['reset-data','بازنشانی کامل داده‌ها']]},
    {title:'مدیریت',items:[['manage-regions','مدیریت مناطق و استان‌ها'],['manage-categories','مدیریت دسته‌بندی‌ها'],['manage-users','مدیریت کاربران و دسترسی‌ها']]}
  ];
  const PERMISSIONS=new Set(PERMISSION_GROUPS.flatMap(group=>group.items.map(([id])=>id)));
  const allPermissions=()=>[...PERMISSIONS];
  const legacyPermissions=role=>role===1?allPermissions():role===2?allPermissions().filter(p=>!['save-results','refresh-panel','import-data','empty-data','restore-data','reset-data','manage-users'].includes(p)):role===3?['view-sheets','search','view-history','edit-cells','refresh-index','export-xlsx','backup-server']:['view-sheets','search'];
  const allKnownCategoryIds=()=>[...new Set([...(typeof managedCategories==='function'?managedCategories().map(c=>c.id):[]),'other'])];
  const normalizeAccessUser=user=>{
    const sheets=Array.isArray(user?.sheets)?user.sheets.filter(v=>typeof v==='string'):[];
    const legacy=!Array.isArray(user?.categories)||!Array.isArray(user?.permissions);
    const inferred=user?.role<=2?allKnownCategoryIds():[...new Set(sheets.map(s=>typeof categoryOf==='function'?categoryOf(s)?.id:null).filter(Boolean))];
    if(user?.role>2&&Array.isArray(user?.regions)&&user.regions.length&&!inferred.includes('provinces'))inferred.push('provinces');
    const supplied=Array.isArray(user?.categories)?user.categories.filter(v=>typeof v==='string'):inferred;
    const regions=legacy&&user?.role<=2&&typeof managedRegions==='function'?managedRegions().filter(r=>r.id!=='unassigned').map(r=>r.id):(Array.isArray(user?.regions)?user.regions.filter(v=>typeof v==='string'):[]);
    return {...user,legacy,sheets,regions:[...new Set(regions)],categories:[...new Set(supplied.includes('*')?allKnownCategoryIds():supplied)],permissions:Array.isArray(user?.permissions)?[...new Set(user.permissions.filter(v=>PERMISSIONS.has(v)))]:legacyPermissions(user?.role)};
  };
  async function credential(password){
    if(password.length<4||password.length>128)throw Error('رمز باید بین ۴ تا ۱۲۸ نویسه باشد.');
    return {password};
  }
  async function persist(next){
    // Do not silently broaden a retained legacy account when an administrator
    // saves somebody else. A legacy row is migrated only when its own form is
    // saved through the custom editor.
    const users=next.users.map(user=>{
      if(!user.legacy)return user;
      const {legacy,categories,permissions,...legacyUser}=user;return legacyUser;
    });
    const result=await FamShared.api('users',{revision:usersRevision,users});
    db={users:result.users.map(normalizeAccessUser)};usersRevision=result.revision;
  }
  function establish(user){
    const normalized=normalizeAccessUser(user),found=db.users.findIndex(u=>u.id===normalized.id);
    if(found<0)db.users.push(normalized);else db.users[found]=normalized;
    activeId=normalized.id;state.user=normalized.name;
    document.documentElement.dataset.role='custom';
    document.documentElement.classList.remove('auth-pending');FamShared.identity(normalized.revision);
  }
  function current(){
    const user=db.users.find(u=>u.id===activeId&&u.enabled);
    return user?JSON.parse(JSON.stringify(user)):null;
  }
  const has=(user,permission)=>!!user&&user.permissions.includes(permission);
  const dataPermission=user=>['view-sheets','search','edit-cells','save-results','add-record','remove-record','undo-remove','export-xlsx'].some(permission=>has(user,permission));
  function scopeAllowsSheet(user,sheet){
    if(!SheetExists(sheet)||IsSystemSheet(sheet))return false;
    const category=categoryOf(sheet)?.id||'other';
    if(!user.categories.includes(category))return false;
    if(category!=='provinces')return true;
    const provincial=provinceOf(sheet);return !!provincial&&user.regions.includes(provincial.region);
  }
  function hasFullDataScope(user){
    if(!allKnownCategoryIds().every(id=>user.categories.includes(id)))return false;
    return managedRegions().filter(r=>r.id!=='unassigned').every(region=>user.regions.includes(region.id));
  }
  function can(operation,sheet){
    const u=current();if(!u)return false;
    if(operation==='own-password')return true;
    const scoped={read:'view-sheets','search-read':'search',manual:'edit-cells',export:'export-xlsx',backup:'backup-server',add:'add-record',remove:'remove-record','save-results':'save-results','view-history':'view-history',undo:'undo-remove'}[operation];
    if(scoped&&sheet!==undefined)return has(u,scoped)&&scopeAllowsSheet(u,sheet);
    if(operation==='read')return has(u,'view-sheets');
    if(operation==='search-read')return has(u,'search');
    if(operation==='data-access')return dataPermission(u);
    if(operation==='global-history')return has(u,'view-history');
    const capability={users:'manage-users',admin:'manage-system',source:'source-code',manual:'edit-cells',export:'export-xlsx',backup:'backup-server','view-sheets':'view-sheets','refresh-index':'refresh-index',search:'search',workspace:'view-sheets',add:'add-record',remove:'remove-record',undo:'undo-remove','save-results':'save-results','refresh-panel':'refresh-panel',import:'import-data','empty-data':'empty-data',restore:'restore-data',reset:'reset-data','manage-regions':'manage-regions','manage-categories':'manage-categories','view-history':'view-history'}[operation];
    if(['import','refresh-index','empty-data','restore','reset'].includes(operation))return !!capability&&has(u,capability)&&hasFullDataScope(u);
    return capability?has(u,capability):false;
  }
  function requirePermission(operation,sheet){
    if(can(operation,sheet))return true;
    Toast('این عملیات در مجوزهای حساب شما فعال نیست.','warn');return false;
  }
  function macroAllowed(path){
    if(path==='modExportAllModules.ExportAllModules')return can('source');
    const common=['modSearchEngine.SearchRecords','modSearchEngine.OpenSearchResults','modSearchEngine.ClearSearchResults','modUI.ToggleExactMatch','modUI.NavigateToSheet','modNavigator.ShowSheetNavigator','modNavigator.CloseNavigator'];
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
    if(a==='reset-empty')return can('empty-data');
    if(a==='reset-all')return can('reset');
    if(a==='manage-regions')return can('manage-regions');
    if(['manage-categories','manage-category-sections'].includes(a))return can('manage-categories');
    if(['open-sheet','nav-sheet','show-more-rows'].includes(a))return can('workspace')&&can('read',node.dataset.name);
    if(['toggle-sidebar','toggle-fold','go-cp'].includes(a))return !!current();
    if(['province-region','province-section','open-category','set-filter','filter-rows','quick-exact'].includes(a))return can('workspace');
    if(a==='switch-view')return viewAllowed(node.dataset.view);
    if(a==='toggle-quick'){
      const panel=node.getAttribute('aria-controls')||'';
      return ({'quick-search':can('search'),'quick-add':can('add'),'quick-remove':can('remove'),'quick-undo':can('undo'),'quick-nav':can('workspace')})[panel]||false;
    }
    return can('admin');
  }
  function viewAllowed(view){
    if(view==='panel')return can('data-access');
    if(view==='sheet')return can('view-sheets');
    if(view==='results')return can('search')||can('remove');
    if(view==='log')return can('view-history');
    return can('admin');
  }
  const DENIED_TEXT='شما دسترسی به این بخش ندارید.';
  function setAccessNotice(container,allowed){
    if(!container)return;container.classList.toggle('access-denied-card',!allowed);container.setAttribute('aria-disabled',String(!allowed));
    const body=container.querySelector('.card-body')||container;let note=body.querySelector(':scope > .access-denied-note');
    if(!note){note=el('p',{class:'access-denied-note',role:'status',text:DENIED_TEXT});body.appendChild(note);}note.hidden=allowed;
  }
  function hideOperations(){
    if(!current())return;
    document.querySelectorAll('[data-act]').forEach(node=>{const permitted=actionAllowed(node);node.classList.toggle('access-hidden',!permitted);if(node.matches('button'))node.setAttribute('aria-disabled',String(!permitted));});
    document.querySelectorAll('.tab-btn[data-view]').forEach(node=>node.classList.toggle('access-hidden',!viewAllowed(node.dataset.view)));
    const cards=document.querySelectorAll('#fold-ops .grid-add > .card');
    setAccessNotice(cards[0],can('search'));setAccessNotice(cards[1],can('add'));setAccessNotice(cards[2],can('remove'));
    setAccessNotice(document.querySelector('#fold-cats .fold-inner'),can('view-sheets'));
    setAccessNotice(document.querySelector('#fold-nav .fold-inner'),can('workspace'));
    const tools=document.querySelector('#fold-tools .fold-inner');setAccessNotice(tools,[...document.querySelectorAll('#fold-tools [data-act]')].some(actionAllowed));
    setAccessNotice(document.querySelector('#fold-status .grid-2 > .card:first-child'),can('view-history'));
  }
  function field(label,id,type='text',value=''){
    const input=el('input',{id,type,class:'inp',value,required:true,autocomplete:type==='password'?'new-password':'off'});
    return {input,node:el('label',{class:'access-field',for:id},el('span',{text:label}),input)};
  }
  async function start(){
    try{const session=await FamShared.api('session');FamShared.setCsrf(session.csrf);establish(session.user);return;}catch(e){}
    await new Promise(resolve=>{
      const root=el('div',{id:'auth-screen'}),form=el('form',{class:'access-login'});
      const u=field('نام کاربری','auth-username','text'),p=field('رمز عبور','auth-password','password');
      u.input.autocomplete='username';p.input.autocomplete='current-password';
      const error=el('p',{id:'auth-error',role:'alert'}),submit=el('button',{type:'submit',id:'auth-submit',class:'btn btn-primary',text:'ورود به سرور'});
      form.append(el('h2',{text:'ورود به فام'}),el('p',{class:'hint',text:'نسخهٔ مرکزی — حساب‌ها و داده‌ها روی سرور مشترک‌اند. اتصال به سرور برای ورود و ثبت تغییرات لازم است.'}),u.node,p.node,error,submit);
      form.addEventListener('submit',async e=>{
        e.preventDefault();submit.disabled=true;error.textContent='';
        try{const result=await FamShared.api('login',{username:username(u.input.value),password:p.input.value});FamShared.setCsrf(result.csrf);establish(result.user);p.input.value='';root.remove();resolve();}
        catch(err){error.textContent=err.message;p.input.value='';}
        finally{submit.disabled=false;}
      });
      root.append(form);document.body.append(root);u.input.focus();
    });
  }
  async function logout(){
    try{await FamShared.flush();await FamShared.api('logout',{});location.reload();}
    catch(e){Toast('خروج انجام نشد: '+e.message,'err');}
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
  // credentials of the authenticated owner. Account-management capability is checked server-side.
  function editOwnPassword(){
    if(!requirePermission('own-password'))return;
    const ov=document.getElementById('modal-overlay'),previous=document.activeElement;
    const box=el('div',{class:'mbox own-password-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'password-title'});
    const form=el('form',{id:'password-form'}),error=el('p',{id:'password-error',role:'alert'});
    const old=field('رمز عبور فعلی','password-current','password'),fresh=field('رمز عبور جدید','password-new','password'),repeat=field('تکرار رمز عبور جدید','password-confirm','password');
    old.input.autocomplete='current-password';[old,fresh,repeat].forEach(f=>{f.input.maxLength=128;f.input.dir='ltr';});
    let saving=false;
    const close=()=>{if(saving)return;ov.classList.remove('show');clear(ov);previous?.isConnected&&previous.focus();};
    const save=el('button',{type:'submit',id:'password-save',class:'btn btn-primary',text:'ثبت روی سرور'}),cancel=el('button',{type:'button',id:'password-cancel',class:'btn btn-ghost',text:'انصراف',onclick:close});
    form.append(old.node,fresh.node,repeat.node,error,el('div',{class:'f'},save,cancel));
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(saving)return;error.textContent='';
      if(fresh.input.value!==repeat.input.value){error.textContent='تکرار رمز یکسان نیست.';return;}
      saving=true;save.disabled=true;cancel.disabled=true;
      try{const result=await FamShared.api('password',{currentPassword:old.input.value,newPassword:fresh.input.value});establish(result.user);saving=false;close();Toast('رمز روی سرور تغییر کرد.','ok');}
      catch(err){error.textContent=err.message;}
      finally{saving=false;save.disabled=false;cancel.disabled=false;}
    });
    box.append(el('div',{class:'t'},el('span',{id:'password-title',text:'تغییر رمز حساب من'}),el('button',{type:'button',id:'password-close',class:'btn btn-ghost',text:'×',onclick:close})),form);
    box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
    clear(ov);ov.append(box);ov.classList.add('show');old.input.focus();
  }
  async function manageUsers(){
    if(!requirePermission('users'))return;
    try{const result=await FamShared.api('users');db={users:result.users.map(normalizeAccessUser)};usersRevision=result.revision;}catch(e){Toast(e.message,'err');return;}
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
      const draft=normalizeAccessUser(original?JSON.parse(JSON.stringify(original)):{id:crypto.randomUUID(),username:'',name:'',role:4,enabled:true,legacy:false,regions:[],sheets:[],categories:[],permissions:[]});
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
          const changed={...draft,legacy:false,username:username(un.input.value),name:name.input.value.trim(),enabled:enabled.checked,
            categories:[...cs],regions:cs.has('provinces')?[...rs]:[],sheets:[],permissions:[...ps],revision:crypto.randomUUID()};
          if(!/^[a-z0-9_.-]{3,40}$/.test(changed.username))throw Error('نام کاربری باید ۳ تا ۴۰ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
          if(!changed.name || changed.name.length>60)throw Error('نام نمایشی باید بین ۱ تا ۶۰ نویسه باشد.');
          if(db.users.some(u=>u.id!==changed.id && u.username===changed.username))throw Error('این نام کاربری قبلاً ثبت شده است.');
          if(pw.input.value)Object.assign(changed,await credential(pw.input.value));
          if(!can('users'))throw Error('مجوز مدیریت کاربران تغییر کرده است.');
          const next={version:1,users:original?db.users.map(u=>u.id===original.id?changed:u):db.users.concat(changed)};
          if(!next.users.some(u=>u.enabled&&u.permissions.includes('manage-users')))throw Error('حداقل یک مدیر فعال مدیریت کاربران لازم است. برای ساخت حساب جداگانه، «کاربر جدید» را بزنید.');
          await persist(next);pw.input.value='';
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
          await persist(next);
          if(original.id===activeId){await logout();return;}selected=null;status.textContent='کاربر حذف شد؛ فرم افزودن کاربر جدید آماده است.';drawList();drawEditor();
        }catch(e){error.textContent=e.message;}
      }));
    };
    box.append(el('div',{class:'t'},el('span',{id:'users-title',text:'مدیریت کاربران سرور'}),button('×','users-close',close)),
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
  // Custom access uses the regular application views; no level-specific viewer.
  function renderViewer(){ document.getElementById('access-viewer')?.remove(); }
  return Object.freeze({start,current,can,require:requirePermission,macroAllowed,actionAllowed,viewAllowed,hideOperations,accountMenu,editOwnPassword,manageUsers,logout,renderViewer});
})();
