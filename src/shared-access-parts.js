/* Source fragments embedded by build_shared.py; not loaded as a script. */
// === persistence ===
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
    document.documentElement.classList.remove('auth-pending');
  }
  function current(){
    const user=db.users.find(u=>u.id===activeId&&u.enabled);
    return user?JSON.parse(JSON.stringify(user)):null;
  }
// === start ===
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
// === password ===
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
// === end ===
