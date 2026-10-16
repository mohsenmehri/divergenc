/* Local workspace entry only: no credentials, persistence or network requests. */
(()=>{
  'use strict';
  let dialog=null;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function symbol(kind){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value]of Object.entries({viewBox:'0 0 48 48',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
    const shapes=kind==='panel'?[['ellipse',{cx:24,cy:11,rx:15,ry:6}],['path',{d:'M9 11v13c0 8 30 8 30 0V11M9 24v13c0 8 30 8 30 0V24M9 18c0 8 30 8 30 0M9 31c0 8 30 8 30 0'}]]:[['rect',{x:6,y:7,width:36,height:13,rx:4}],['rect',{x:6,y:28,width:36,height:13,rx:4}],['path',{d:'M16 20v8M32 20v8M13 13h.01M19 13h.01M27 13h8M13 34h.01M19 34h.01M27 34h8'}]];
    for(const [tag,attrs]of shapes){const item=document.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))item.setAttribute(key,value);svg.append(item);}return svg;
  }
  function choose(view){
    if(!['panel','equipment'].includes(view)||!Access.current()||!Access.viewAllowed(view))return false;
    dialog?.close();document.documentElement.classList.remove('workspace-choosing');
    // Reuse the application's normal navigation, including the equipment RAM
    // session lifecycle. Choosing a workspace is never a logout or re-login.
    document.querySelector('.tab-btn[data-view="'+view+'"]').click();
    if(innerWidth<=760)setSidebarOpen(false);
    const target=document.getElementById('view-'+view);target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
    return true;
  }
  function show(){
    const user=Access.current();if(!user||document.documentElement.classList.contains('auth-pending'))return;
    if(!dialog){dialog=node('dialog','workspace-launcher');dialog.id='workspace-launcher';dialog.setAttribute('aria-labelledby','workspace-title');dialog.addEventListener('cancel',event=>event.preventDefault());dialog.addEventListener('close',()=>{if(!dialog.open)document.documentElement.classList.remove('workspace-choosing');});document.body.append(dialog);}
    if(dialog.open)return;
    dialog.replaceChildren();
    const shell=node('div','workspace-portal'),top=node('div','workspace-portal-top');
    top.append(node('span','workspace-brand','FAM'),node('span','workspace-user',user.name+'، خوش آمدید'));
    const exit=node('button','workspace-exit','خروج از حساب');exit.type='button';exit.id='workspace-logout';exit.addEventListener('click',()=>Access.logout());top.append(exit);
    const heading=node('h1','','از کجا شروع کنیم؟');heading.id='workspace-title';
    shell.append(top,node('p','workspace-kicker','ONE ACCOUNT · TWO WORKSPACES'),heading,node('p','workspace-intro','فضای کاری خود را انتخاب کنید؛ هر زمان خواستید بین دو بخش جابه‌جا شوید.'));
    const choices=node('div','workspace-options');
    for(const [view,title,sub,index]of [['panel','پایگاه داده','داشبورد، جست‌وجو و مدیریت داده‌های شبکه','01'],['equipment','مدیریت تجهیزات','نودها، دسته‌بندی‌ها و نمای مدیریت تجهیز','02']]){
      const allowed=Access.viewAllowed(view),button=node('button','workspace-option workspace-option-'+view);button.type='button';button.id='workspace-enter-'+view;button.disabled=!allowed;button.setAttribute('aria-label',title);
      const icon=node('span','workspace-symbol');icon.append(symbol(view));
      button.append(node('span','workspace-number',index),icon,node('strong','',title),node('span','workspace-description',sub),node('span','workspace-enter',allowed?'ورود به این بخش ←':'دسترسی به این بخش ندارید'));
      button.addEventListener('click',()=>choose(view));choices.append(button);
    }
    shell.append(choices,node('p','workspace-footnote','یک حساب مشترک · دو فضای مستقل · جابه‌جایی بدون خروج'));dialog.append(shell);document.documentElement.classList.add('workspace-choosing');dialog.showModal();
    (dialog.querySelector('.workspace-option:not(:disabled)')||exit).focus({preventScroll:true});
  }
  document.addEventListener('click',event=>{if(event.target.closest('[data-workspace-picker]'))show();});
  window.FamWorkspaceLauncher=Object.freeze({show,choose});
})();
