/* Central accounts: server sessions and permissions; no local credential store. */
const Access = (() => {
  let db={users:[]},activeId=null,usersRevision=0;
  const username=s=>String(s||'').trim().toLowerCase();
  async function credential(password){
    if(password.length<4||password.length>128)throw Error('رمز باید بین ۴ تا ۱۲۸ نویسه باشد.');
    return {password};
  }
  async function persist(next){
    const result=await FamShared.api('users',{revision:usersRevision,users:next.users});
    db={users:result.users};usersRevision=result.revision;
  }
  function establish(user){
    const found=db.users.findIndex(u=>u.id===user.id);
    if(found<0)db.users.push(user);else db.users[found]=user;
    activeId=user.id;state.user=user.name;
    document.documentElement.dataset.role=String(user.role);
    document.documentElement.classList.remove('auth-pending');FamShared.identity(user.revision);
  }
  function current(){
    const user=db.users.find(u=>u.id===activeId&&u.enabled);
    return user?JSON.parse(JSON.stringify(user)):null;
  }
  // Mirror the server's scope rule: region assignments govern provincial
  // worksheets; individually granted sheet names govern every other worksheet.
  function scopeAllowsSheet(user,sheet){
    const provincial=provinceOf(sheet);
    return provincial ? user.regions.includes(provincial.region) : user.sheets.includes(sheet);
  }
  function can(operation,sheet){
    const u=current();if(!u)return false;
    if(['users','source'].includes(operation))return u.role===1;
    if(operation==='own-password')return true;
    if(operation==='read'){
      if(!SheetExists(sheet))return false;
      if(u.role<=2)return true;
      if(IsSystemSheet(sheet))return false;
      return scopeAllowsSheet(u,sheet);
    }
    // Central category/region metadata is a server-authorised administrative
    // operation. Levels 1 and 2 may manage it; the API independently rejects
    // a crafted metadata write by a scoped level-3/4 account.
    if(['admin','undo','manage-categories','manage-regions'].includes(operation))return u.role<=2;
    if(operation==='manual')return u.role<=3;
    if(operation==='export')return u.role<=3;
    if(operation==='backup')return u.role<=3;
    if(operation==='refresh-index')return u.role<=3;
    if(['search','workspace'].includes(operation))return u.role<=4;
    if(['add','remove'].includes(operation))return u.role<=2;
    if(['save-results','refresh-panel','import','empty-data','restore','reset'].includes(operation))return u.role===1;
    return false;
  }
  function requirePermission(operation,sheet){
    if(can(operation,sheet))return true;
    Toast('این عملیات برای سطح دسترسی شما مجاز نیست.','warn');return false;
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
    return current()?.role===1;
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
    if(['manage-categories','manage-category-sections'].includes(a))return can('manage-categories');
    if(['open-sheet','nav-sheet','show-more-rows'].includes(a))return can('workspace') && can('read',node.dataset.name);
    if(['go-cp','toggle-sidebar','toggle-fold','province-region','province-section','open-category','set-filter','filter-rows','quick-exact'].includes(a))return can('workspace');
    if(a==='switch-view')return viewAllowed(node.dataset.view);
    if(a==='toggle-quick')return can('workspace') && (node.getAttribute('aria-controls')!=='quick-undo' || can('undo'));
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
    const content=el('div',{},el('p',{text:u.name+' — '+u.username+' — سطح '+u.role}));
    if(can('users'))content.appendChild(el('button',{type:'button',class:'btn btn-primary',id:'account-manage',text:'مدیریت کاربران',onclick:()=>{document.querySelector('#modal-overlay button[data-id="1"]')?.click();manageUsers();}}));
    content.appendChild(el('button',{type:'button',class:'btn btn-primary',id:'account-password',text:can('users')?'تغییر رمز عبور من':'ویرایش حساب من (فقط رمز عبور)',onclick:()=>{document.querySelector('#modal-overlay button[data-id="1"]')?.click();editOwnPassword();}}));
    content.appendChild(el('button',{type:'button',class:'btn btn-ghost',id:'account-logout',text:'خروج از حساب',onclick:()=>logout()}));
    ModalBox({title:'حساب کاربری',contentNode:content,buttons:[{id:IDOK,label:'بستن',cls:'ok'}]});
  }
  // No target ID or profile payload is accepted: this path can only replace the
  // credentials of the authenticated owner. Full account edits stay level-1-only.
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
    try{const result=await FamShared.api('users');db={users:result.users};usersRevision=result.revision;}
    catch(e){Toast(e.message,'err');return;}
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
      summary.textContent=db.users.length.toLocaleString('fa-IR')+' کاربر ذخیره‌شده · '+db.users.filter(u=>u.enabled&&u.role===1).length.toLocaleString('fa-IR')+' مدیر فعال سطح ۱';
      clear(list);db.users.forEach(u=>{
        const item=button('ویرایش: '+u.name+' ('+u.username+') · سطح '+u.role+(u.enabled?'':' · غیرفعال'),'user-'+u.id,()=>{
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
      const draft=original?JSON.parse(JSON.stringify(original)):{id:crypto.randomUUID(),username:'',name:'',role:3,enabled:true,regions:[],sheets:[]};
      const form=el('form',{id:'user-form','data-mode':original?'edit':'create','data-user-id':draft.id}),error=el('p',{id:'user-error',role:'alert',class:'category-error'});
      const mode=el('div',{class:'user-editor-mode'},
        el('h3',{id:'user-mode-title',text:original?'ویرایش کاربر: '+original.username:'افزودن کاربر جدید'}),
        el('p',{class:'hint',text:original
          ? 'ذخیره، همین حساب را تغییر می‌دهد؛ حتی اگر نام کاربری را عوض کنید. برای ساخت حساب جداگانه، «کاربر جدید» را بزنید.'
          : 'این فرم یک حساب مستقل می‌سازد؛ هیچ‌یک از کاربران موجود تغییر نمی‌کنند.'}));
      const un=field('نام کاربری','user-username','text',draft.username),name=field('نام نمایشی','user-name','text',draft.name);
      const pw=field(original?'رمز جدید (خالی = بدون تغییر)':'رمز عبور','user-password','password');pw.input.required=!original;
      un.input.maxLength=40;name.input.maxLength=60;pw.input.maxLength=128;
      const role=el('select',{id:'user-role',class:'inp'});
      [[1,'سطح ۱'],[2,'سطح ۲'],[3,'سطح ۳'],[4,'سطح ۴']]
        .forEach(([v,t])=>role.appendChild(el('option',{value:String(v),text:t})));
      role.value=String(draft.role);
      const enabled=el('input',{type:'checkbox',id:'user-enabled',checked:draft.enabled});
      const scopes=el('div',{id:'user-scopes'}),rs=new Set(draft.regions);
      const regionOptions=managedRegions().filter(r=>r.id!=='unassigned');
      const regions=el('div',{class:'access-scopes','aria-label':'مناطق مجاز'});
      const syncRegionChecks=()=>regions.querySelectorAll('input[data-user-region]').forEach(input=>{input.checked=rs.has(input.dataset.userRegion);});
      const setAllRegions=selected=>{regionOptions.forEach(r=>selected?rs.add(r.id):rs.delete(r.id));syncRegionChecks();};
      scopes.append(
        el('p',{class:'hint',text:'برای سطح ۳ و ۴، فقط داده‌های منطقه‌های تیک‌خورده قابل مشاهده و جست‌وجو هستند. انتخاب خالی یعنی هیچ منطقه‌ای مجاز نیست؛ «همهٔ مناطق» چهار منطقه را انتخاب می‌کند.'}),
        el('div',{class:'category-edit-actions'},
          el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'همهٔ مناطق',onclick:()=>setAllRegions(true)}),
          el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'پاک‌کردن انتخاب',onclick:()=>setAllRegions(false)})),
        el('h4',{text:'مناطق مجاز'}),regions);
      regionOptions.forEach(r=>regions.appendChild(el('label',{},el('input',{type:'checkbox','data-user-region':r.id,checked:rs.has(r.id),onchange:e=>{e.target.checked?rs.add(r.id):rs.delete(r.id);}}),txt(r.name))));
      if(!regionOptions.length)regions.appendChild(el('p',{class:'hint',text:'منطقه‌ای تعریف نشده است.'}));
      const showScopes=()=>{scopes.hidden=!['3','4'].includes(role.value);};role.addEventListener('change',showScopes);showScopes();
      const save=el('button',{type:'submit',id:'user-save',class:'btn btn-primary',text:'ثبت'});
      const saveAndNew=el('button',{type:'submit',id:'user-save-new',class:'btn btn-cyan',text:'ثبت و ایجاد کاربر جدید'});
      const cancel=el('button',{type:'button',id:'user-cancel',class:'btn btn-ghost',text:'لغو',onclick:close});
      const formActions=el('div',{class:'f user-form-actions'},save,cancel,saveAndNew);
      form.append(mode,un.node,name.node,pw.node,el('label',{for:'user-role',text:'سطح دسترسی'}),role,
        el('label',{class:'access-check'},enabled,txt('حساب فعال است')),scopes,error,formActions);
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(saving || !requirePermission('users'))return;
        const createAnother=e.submitter?.id==='user-save-new';
        saving=true;save.disabled=true;saveAndNew.disabled=true;cancel.disabled=true;error.textContent='';
        try{
          const scoped=['3','4'].includes(role.value);
          const changed={...draft,username:username(un.input.value),name:name.input.value.trim(),role:Number(role.value),enabled:enabled.checked,
            regions:scoped?[...rs]:[],sheets:scoped?[]:[],revision:crypto.randomUUID()};
          if(!/^[a-z0-9_.-]{3,40}$/.test(changed.username))throw Error('نام کاربری باید ۳ تا ۴۰ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
          if(!changed.name || changed.name.length>60)throw Error('نام نمایشی باید بین ۱ تا ۶۰ نویسه باشد.');
          if(db.users.some(u=>u.id!==changed.id && u.username===changed.username))throw Error('این نام کاربری قبلاً ثبت شده است.');
          if(pw.input.value)Object.assign(changed,await credential(pw.input.value));
          if(!can('users'))throw Error('مجوز مدیریت کاربران تغییر کرده است.');
          const next={version:1,users:original?db.users.map(u=>u.id===original.id?changed:u):db.users.concat(changed)};
          if(original && !next.users.some(u=>u.enabled&&u.role===1))throw Error('حداقل یک مدیر فعال سطح ۱ لازم است. شما در حال ویرایش حساب «'+original.username+'» هستید، نه افزودن کاربر جدید. برای ساخت حساب جداگانه، «کاربر جدید» را بزنید.');
          await persist(next);pw.input.value='';
          if(changed.id===activeId){if(!changed.enabled || changed.role!==1){await logout();return;}establish(db.users.find(u=>u.id===changed.id)||changed);}
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
        try{await persist({version:1,users:db.users.filter(u=>u.id!==original.id)});
          if(original.id===activeId){await logout();return;}selected=null;status.textContent='کاربر حذف شد؛ فرم افزودن کاربر جدید آماده است.';drawList();drawEditor();
        }catch(e){error.textContent=e.message;}
      }));
    };
    box.append(el('div',{class:'t'},el('span',{id:'users-title',text:'مدیریت کاربران سرور'}),button('×','users-close',close)),
      el('div',{class:'c'},el('p',{class:'hint',text:'فقط سطح ۱ کاربران را مدیریت می‌کند. رمزها به صورت متن ذخیره یا نمایش داده نمی‌شوند. تغییرات فرم تا ذخیره اعمال نمی‌شوند. حساب‌ها در پشتیبان دادهٔ اکسل/JSON قرار نمی‌گیرند.'}),
        button('+ کاربر جدید','user-new',()=>{if(saving)return;selected=null;status.textContent='';drawList();drawEditor();area.querySelector('#user-username').focus();}),summary,status,el('div',{class:'category-manager-grid'},list,area)),
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
  return Object.freeze({start,current,can,require:requirePermission,macroAllowed,actionAllowed,viewAllowed,hideOperations,accountMenu,editOwnPassword,manageUsers,logout,renderViewer});
})();
