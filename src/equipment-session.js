/* Equipment account belongs to the workspace session, never a page or storage. */
window.FamEquipmentSession=(()=>{
 'use strict';
 let account={username:'',password:''},dialog=null,resolvePending=null;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const ready=()=>!!(account.username&&account.password);
 function dismiss(value=false){if(dialog){const old=dialog;dialog=null;old.querySelector('form')?.reset();old.close();old.remove();}const done=resolvePending;resolvePending=null;done?.(value);}
 function changed(){document.dispatchEvent(new Event('fam-equipment-session-changed'));}
 function clear(){account={username:'',password:''};dismiss();changed();}
 function request({force=false}={}){
  if(!Access.current()||!Access.can('equipment')||!Access.can('equipment-scan'))return Promise.resolve(false);
  if(window.FamEquipmentLive?.isBusy())return Promise.resolve(false);
  if(ready()&&!force)return Promise.resolve(true);
  if(dialog)return Promise.resolve(false);
  const owner=Access.current().id;
  return new Promise(resolve=>{
   resolvePending=resolve;dialog=el('dialog','eq-dialog eq-session-dialog');dialog.id='eq-equipment-login';dialog.setAttribute('aria-labelledby','eq-session-title');
   const eyebrow=el('p','eq-session-eyebrow','فضای تجهیزات'),title=el('h2','','ورود به تجهیزات');title.id='eq-session-title';
   const intro=el('p','eq-session-intro','حساب SSH / RADIUS تجهیزات را یک بار وارد کنید. با رفتن به صفحه‌های دیگر، نیازی به ورود دوباره نیست.');
   const form=el('form'),fields=el('div','eq-session-fields');
   for(const [key,text,type]of [['username','نام کاربری تجهیزات','text'],['password','رمز عبور تجهیزات','password']]){
    const label=el('label','eq-field',text),input=el('input','inp');input.id='eq-session-'+key;input.name=key;input.type=type;input.required=true;input.dir='ltr';input.maxLength=key==='username'?64:512;input.autocomplete=key==='username'?'off':'new-password';input.spellcheck=false;label.append(input);fields.append(label);
   }
   const notice=el('p','eq-session-privacy','فقط در حافظهٔ این نشست؛ با خروج از حساب، بستن یا تازه‌سازی صفحه پاک می‌شود. این مرحله هیچ اتصالی به تجهیز برقرار نمی‌کند.');
   const error=el('p','eq-error');error.setAttribute('role','alert');const actions=el('div','eq-session-actions'),submit=el('button','btn btn-primary','ورود به فضای تجهیزات'),cancel=el('button','btn btn-ghost','انصراف');submit.type='submit';submit.id='eq-session-submit';cancel.type='button';cancel.onclick=()=>dismiss();actions.append(submit,cancel);form.append(fields,notice,error,actions);
   form.onsubmit=e=>{e.preventDefault();if(!Access.current()||Access.current().id!==owner||!Access.can('equipment')||!Access.can('equipment-scan')){dismiss();return;}
    const username=form.elements.username.value.trim(),password=form.elements.password.value;
    if(!/^[A-Za-z0-9][A-Za-z0-9_.@\\-]{0,63}$/.test(username)||!/^[\x20-\x7e]{1,512}$/.test(password)){error.textContent='نام کاربری یا رمز عبور با قالب اتصال تجهیزات سازگار نیست.';return;}
    account={username,password};dismiss(true);changed();
   };
   dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});dialog.append(eyebrow,title,intro,form);document.body.append(dialog);dialog.showModal();form.elements.username.focus();
  });
 }
 // Capture both launcher and sidebar entry before normal application navigation.
 document.addEventListener('click',async e=>{
  const trigger=e.target.closest?.('#workspace-enter-equipment,.tab-btn[data-view="equipment"]');
  if(!trigger||ready()||!Access.current()||!Access.can('equipment')||!Access.can('equipment-scan'))return;
  e.preventDefault();e.stopImmediatePropagation();if(await request())if(trigger.isConnected)trigger.click();
 },true);
 document.addEventListener('fam-access-changed',clear);window.addEventListener('pagehide',clear);
 document.addEventListener('click',e=>{if(e.target.closest?.('#account-logout,#workspace-logout'))clear();},true);
 return Object.freeze({ready,request,read:()=>({...account}),username:()=>account.username,clear});
})();
