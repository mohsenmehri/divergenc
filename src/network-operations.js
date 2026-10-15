/* Fixed server-side Err-Disable recovery UI for the central FAM client.
   There is deliberately no browser SSH, stored device credential, device map,
   or arbitrary command entry field. */
window.FamNetworkOperations=(()=>{
  let card=null,capabilities=null,loading=false;
  const statusLabel={
    succeeded:'بازیابی انجام شد',
    not_errdisabled:'Err-Disable گزارش نشد',
    still_errdisabled:'نیازمند بررسی بیشتر',
    failed:'ناموفق',
    running:'در حال اجرا'
  };
  const text=value=>String(value??'');
  const when=value=>{
    const date=new Date(Number(value));
    return Number.isNaN(date.getTime())?'—':date.toLocaleString('fa-IR');
  };
  const allowed=()=>!!Access.current()&&Access.can('network-operation');
  function field(label,id,type='text',hint=''){
    const input=el('input',{id,type,class:'inp',required:true,autocomplete:'off'});
    const root=el('label',{class:'access-field',for:id},el('span',{text:label}),input);
    if(hint)root.appendChild(el('small',{class:'hint',text:hint}));
    return {input,root};
  }
  function operationEntry(operation){
    const result=operation.result||{};
    const entry=el('article',{class:'network-operation-entry is-'+text(operation.status)},
      el('div',{},el('b',{text:(statusLabel[operation.status]||operation.status)+' · '+operation.target+' · '+operation.interface}),
        el('small',{text:'  |  '+(operation.deviceType==='router'?'روتر':'سوئیچ')+'  |  '+operation.operator+'  |  '+when(operation.createdAt)})),
      el('p',{class:'op-result',text:text(result.message||'نتیجه‌ای ثبت نشده است.')}));
    return entry;
  }
  function paintHistory(operations){
    const list=card?.querySelector('#network-operation-list');if(!list)return;
    clear(list);
    if(!operations.length){list.appendChild(el('p',{class:'hint',text:'هنوز عملیاتی در این پنل ثبت نشده است.'}));return;}
    operations.forEach(operation=>list.appendChild(operationEntry(operation)));
  }
  function paintCapability(){
    if(!card)return;
    card.classList.toggle('access-hidden',!allowed());
    const note=card.querySelector('#network-operation-note'),open=card.querySelector('#network-operation-open');
    if(!allowed())return;
    if(!capabilities){note.textContent='در حال بررسی آمادگی سرویس سرور…';open.disabled=true;return;}
    note.textContent=capabilities.message;
    open.disabled=!capabilities.enabled;
  }
  async function refresh(){
    if(!card||!allowed()||loading)return;
    loading=true;paintCapability();
    try{
      capabilities=await FamShared.api('network-operations/capabilities');
      paintCapability();
      if(capabilities.enabled){const data=await FamShared.api('network-operations');paintHistory(data.operations||[]);}
      else paintHistory([]);
    }catch(error){
      capabilities={enabled:false,message:error.message||'وضعیت عملیات شبکه از سرور دریافت نشد.'};paintCapability();paintHistory([]);
    }finally{loading=false;}
  }
  function closeDialog(previous,saving){
    if(saving())return;
    const overlay=document.getElementById('modal-overlay');overlay.classList.remove('show');clear(overlay);if(previous?.isConnected)previous.focus();
  }
  function openDialog(){
    if(!allowed())return;
    if(!capabilities?.enabled){Toast(capabilities?.message||'عملیات شبکه آماده نیست.','warn');return;}
    const overlay=document.getElementById('modal-overlay'),previous=document.activeElement;
    const dialog=el('section',{class:'mbox network-operation-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'network-operation-title'});
    const form=el('form',{id:'network-operation-form'}),error=el('p',{class:'network-operation-error',role:'alert'}),result=el('pre',{class:'network-operation-result',hidden:true});
    const device=el('select',{id:'network-device-type',required:true});
    device.append(el('option',{value:'router',text:'روتر — حساب RADIUS واردشده توسط اپراتور'}),el('option',{value:'switch',text:'سوئیچ — حساب محلی واردشده توسط اپراتور'}));
    const target=field('IP تجهیز','network-target','text','فقط IPv4 مجازِ تعریف‌شده برای سرویس سرور پذیرفته می‌شود.'),
      username=field('نام کاربری تجهیز','network-username','text','برای روتر: RADIUS؛ برای سوئیچ: حساب محلی. این مقدار ذخیره نمی‌شود.'),
      password=field('رمز عبور تجهیز','network-password','password','فقط برای همین اتصال HTTPS → سرور → SSH استفاده می‌شود و ذخیره/نمایش داده نمی‌شود.'),
      fingerprint=field('اثر انگشت کلید SSH تجهیز','network-fingerprint','text','نمونه: SHA256:…  — برای جلوگیری از اتصال به تجهیز جعلی اجباری است.'),
      iface=field('اینترفیس Cisco','network-interface','text','نمونه: GigabitEthernet1/0/24 یا Gi1/0/24');
    target.input.inputMode='numeric';fingerprint.input.spellcheck=false;username.input.spellcheck=false;password.input.autocomplete='new-password';
    const confirm=el('input',{id:'network-confirm',type:'checkbox',required:true});
    let saving=false;
    const close=()=>closeDialog(previous,()=>saving);
    const submit=el('button',{id:'network-operation-submit',type:'submit',class:'btn btn-primary',text:'اجرای رفع Err-Disable روی سرور'}),cancel=el('button',{type:'button',class:'btn btn-ghost',text:'انصراف',onclick:close});
    form.append(
      el('p',{class:'network-operation-warning',text:'این عملیات فقط پس از مشاهدهٔ Err-Disable، ابتدا Shutdown و سپس No shutdown را روی همان اینترفیس اجرا می‌کند. فرمان enable و ذخیرهٔ startup-config اجرا نمی‌شود.'}),
      el('label',{class:'access-field',for:'network-device-type'},el('span',{text:'نوع تجهیز'}),device),
      target.root,username.root,password.root,fingerprint.root,iface.root,
      el('label',{class:'access-check'},confirm,el('span',{text:'تأیید می‌کنم که مجاز به بازیابی این اینترفیس هستم و اثر قطع‌و‌وصل کوتاه آن را می‌پذیرم.'})), 
      error,result,el('div',{class:'f'},submit,cancel));
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(saving)return;error.textContent='';result.hidden=true;
      if(!allowed()){error.textContent='مجوز عملیات شبکه تغییر کرده است.';return;}
      if(!capabilities?.enabled){error.textContent='سرویس عملیات شبکه آماده نیست.';return;}
      saving=true;submit.disabled=true;cancel.disabled=true;
      const body={requestId:crypto.randomUUID(),action:'recover_errdisable',deviceType:device.value,target:target.input.value.trim(),
        username:username.input.value.trim(),password:password.input.value,hostFingerprint:fingerprint.input.value.trim(),interface:iface.input.value.trim(),confirmed:confirm.checked};
      try{
        const response=await FamShared.api('network-operations',body),operation=response.operation||{};
        const detail=operation.result||{};
        result.textContent=(detail.message||'')+(detail.output?'\n\n'+detail.output:'');result.hidden=false;
        if(operation.status==='succeeded')Toast('بازیابی اینترفیس روی سرور ثبت شد.','ok');
        else Toast(detail.message||'عملیات شبکه نتیجهٔ موفق نداشت.','warn');
        password.input.value='';await refresh();
      }catch(requestError){
        password.input.value='';error.textContent=requestError.message||'عملیات شبکه انجام نشد.';
      }finally{saving=false;submit.disabled=false;cancel.disabled=false;}
    });
    dialog.append(el('div',{class:'t'},el('span',{id:'network-operation-title',text:'رفع خطای Err-Disable'}),el('button',{type:'button',class:'btn btn-ghost',text:'×',onclick:close})),el('div',{class:'c'},form));
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const items=[...dialog.querySelectorAll('button,input,select')].filter(item=>!item.disabled&&item.getClientRects().length);
        const first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    clear(overlay);overlay.appendChild(dialog);overlay.classList.add('show');target.input.focus();
  }
  function mount(){
    if(card||!document.getElementById('fold-tools'))return;
    const toolsCard=document.getElementById('fold-tools').closest('.dashboard-section');if(!toolsCard)return;
    card=el('section',{class:'card dashboard-section network-operation-card access-hidden','aria-labelledby':'network-operation-heading'},
      el('div',{class:'card-head'},el('div',{class:'ico g-cyan',text:'SSH'}),el('div',{},el('h3',{id:'network-operation-heading',text:'عملیات شبکه'}),el('small',{text:'Server-side device action'}))),
      el('div',{class:'card-body'},el('div',{class:'network-operation-summary'},
        el('div',{},el('p',{id:'network-operation-note',class:'hint',text:'در انتظار ورود به سرور…'}),el('p',{class:'hint',text:'مرورگر به روتر یا سوئیچ SSH نمی‌زند؛ سرویس فام روی سرور این کار را انجام می‌دهد.'})), 
        el('button',{id:'network-operation-open','data-act':'network-operation',type:'button',class:'btn btn-cyan',text:'رفع Err-Disable',onclick:openDialog})),
        el('div',{id:'network-operation-list',class:'network-operation-list'})));
    toolsCard.before(card);
  }
  function ready(){mount();refresh().catch(()=>{});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  window.addEventListener('fam-shared-ready',ready);
  return Object.freeze({refresh,open:openDialog});
})();
