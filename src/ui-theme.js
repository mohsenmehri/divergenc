/* Two visual themes on the same document, workbook, session and origin. */
(function(){
  const key='fam.ui.theme',root=document.documentElement;
  const normalize=value=>value==='light'?'light':'original';
  let current=normalize(root.dataset.defaultTheme);
  try{const saved=localStorage.getItem(key);if(saved==='light'||saved==='original')current=saved;}catch(e){}
  function paint(){
    root.dataset.uiTheme=current;
    document.getElementById('fam-operations-css').media=current==='light'?'all':'not all';
  }
  // Executed in <head>, before the body/login is painted.
  paint();
  function updateButtons(){
    document.querySelectorAll('.fam-theme-toggle').forEach(button=>{
      button.textContent=current==='light'?'تم ۲ ☀':'تم ۱ ◐';
      button.title=current==='light'?'تم ۲: روشن — تغییر به تم اصلی':'تم ۱: اصلی — تغییر به تم روشن';
      button.setAttribute('aria-label',button.title);
      button.setAttribute('aria-pressed',String(current==='light'));
    });
  }
  function set(value,persist=true){
    const next=normalize(value),changed=next!==current;
    current=next;paint();
    window.FamOperationsLayout?.(current==='light');
    updateButtons();
    if(persist){try{localStorage.setItem(key,current);}catch(e){/* Theme still works for this visit. */}}
    if(changed){
      window.famRefreshFx?.();
      // Refit floating menu without changing its open/closed state.
      window.dispatchEvent(new Event('fam:theme-change'));
    }
  }
  window.FamTheme={current:()=>current,set};
  window.addEventListener('storage',e=>{if(e.key===key||e.key===null)set(e.key===null?'original':e.newValue,false);});
  window.addEventListener('DOMContentLoaded',()=>{
    const observed=new WeakSet();
    const observer=new MutationObserver(mount);
    function mount(){
      for(const host of [document.querySelector('#topbar .top-actions'),document.querySelector('.access-login'),document.querySelector('.access-viewer-head')]){
        if(!host||host.querySelector('.fam-theme-toggle'))continue;
        const button=document.createElement('button');
        button.type='button';button.className='icon-btn fam-theme-toggle';
        button.addEventListener('click',()=>set(current==='light'?'original':'light'));
        host.appendChild(button);
      }
      const viewer=document.getElementById('access-viewer');
      if(viewer&&!observed.has(viewer)){observed.add(viewer);observer.observe(viewer,{childList:true});}
      updateButtons();
    }
    // Observe only roots, not workbook rows/cells or typing.
    observer.observe(document.body,{childList:true});
    mount();
    window.FamOperationsLayout?.(current==='light');
  });
})();
