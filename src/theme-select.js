/* Theme-2 select facade. Native <select> popup highlight colours are controlled
   by Windows/Chromium and may ignore option CSS; this keeps the native element
   authoritative while rendering a fully white, keyboard-accessible menu. */
(function(){
  const selector='select.inp,#user-form select';
  let openShell=null;
  const isLight=()=>document.documentElement.dataset.uiTheme==='light';
  const text=value=>String(value||'').replace(/\s+/g,' ').trim();
  function close(shell=openShell){
    if(!shell)return;
    shell.classList.remove('open');
    shell.querySelector('.fam-light-select-toggle')?.setAttribute('aria-expanded','false');
    shell.querySelector('.fam-light-select-menu').hidden=true;
    if(openShell===shell)openShell=null;
  }
  function selectedOption(select){return [...select.options].find(option=>option.selected)||select.options[0]||null;}
  function render(select){
    const shell=select._famLightSelect;if(!shell)return;
    const toggle=shell.querySelector('.fam-light-select-toggle'),menu=shell.querySelector('.fam-light-select-menu');
    const current=selectedOption(select);
    toggle.textContent=current?text(current.textContent):'انتخاب کنید';
    menu.replaceChildren();
    const addOption=option=>{
      const item=document.createElement('button');
      item.type='button';item.className='fam-light-select-option';item.textContent=text(option.textContent);
      item.disabled=option.disabled;item.dataset.value=option.value;item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));
      item.addEventListener('click',()=>{
        if(option.disabled)return;
        select.value=option.value;
        select.dispatchEvent(new Event('input',{bubbles:true}));
        select.dispatchEvent(new Event('change',{bubbles:true}));
        render(select);close(shell);toggle.focus();
      });
      menu.append(item);
    };
    [...select.children].forEach(child=>{
      if(child.tagName==='OPTGROUP'){
        const group=document.createElement('span');group.className='fam-light-select-group';group.textContent=text(child.label);menu.append(group);
        [...child.children].forEach(addOption);
      }else if(child.tagName==='OPTION')addOption(child);
    });
  }
  function build(select){
    if(select._famLightSelect){render(select);return;}
    const shell=document.createElement('div');shell.className='fam-light-select';shell.dataset.for=select.id||'';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='fam-light-select-toggle';toggle.setAttribute('aria-haspopup','listbox');toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label',select.getAttribute('aria-label')||select.labels?.[0]?.textContent||'انتخاب');
    const menu=document.createElement('div');menu.className='fam-light-select-menu';menu.hidden=true;menu.setAttribute('role','listbox');
    toggle.addEventListener('click',event=>{
      event.preventDefault();
      if(!isLight())return;
      if(openShell&&openShell!==shell)close(openShell);
      const opening=!shell.classList.contains('open');
      if(opening){render(select);shell.classList.add('open');toggle.setAttribute('aria-expanded','true');menu.hidden=false;openShell=shell;}
      else close(shell);
    });
    toggle.addEventListener('keydown',event=>{
      if(event.key==='Escape'){close(shell);return;}
      if(['ArrowDown','Enter',' '].includes(event.key)&&!shell.classList.contains('open')){event.preventDefault();toggle.click();menu.querySelector('[aria-selected="true"]')?.focus();}
    });
    menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(shell);toggle.focus();}});
    shell.append(toggle,menu);select.after(shell);select.classList.add('fam-select-native');select._famLightSelect=shell;
    select.addEventListener('change',()=>render(select));select.addEventListener('input',()=>render(select));
    new MutationObserver(()=>render(select)).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['selected','disabled','label']});
    render(select);
  }
  function scan(root=document){
    if(root.matches?.(selector))build(root);
    root.querySelectorAll?.(selector).forEach(build);
  }
  document.addEventListener('pointerdown',event=>{if(openShell&&!openShell.contains(event.target))close(openShell);});
  window.addEventListener('fam:theme-change',()=>{if(!isLight())close(openShell);scan();});
  document.addEventListener('DOMContentLoaded',()=>{
    // The dashboard creates its mirrored quick forms in its own DOM-ready
    // handler. Wait one task so the mirrors are built before any select shell
    // is added, otherwise a cloned shell would be duplicated.
    setTimeout(()=>{
      scan();
      new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node);}))).observe(document.body,{childList:true,subtree:true});
    },0);
  });
})();
