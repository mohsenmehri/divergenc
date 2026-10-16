/* Offline UI preview only. No fetch, API, SSH, credential storage or device access. */
document.addEventListener('DOMContentLoaded',()=>{
  const by=id=>document.getElementById(id),form=by('equipment-check-form');
  if(!form)return;
  const status=by('equipment-status'),submit=by('equipment-check-submit');
  let busy=false,generation=0;
  const show=(text,type='')=>{status.className='equipment-status '+type;status.replaceChildren(document.createTextNode(text));};
  const authorized=()=>Access.can('equipment');
  const clearPassword=()=>{by('equipment-password').value='';};
  const reset=()=>{generation++;clearPassword();show('پیش‌نمایش محلی — سناریو را انتخاب کنید و «بررسی وضعیت پورت‌ها» را بزنید. هیچ اتصال واقعی انجام نمی‌شود.');};
  const delay=()=>new Promise(resolve=>setTimeout(resolve,350));
  const recover=async(port,scenario,checkedGeneration)=>{
    if(busy||!authorized()||checkedGeneration!==generation)return;
    if(!confirm('پیش‌نمایش نمایشی: بازیابی فقط روی پورت '+port+' شبیه‌سازی شود؟\nدر نسخهٔ سرور، وضعیت همین پورت قبل و بعد از shutdown / no shutdown بررسی می‌شود. اینجا هیچ دستور واقعی اجرا نمی‌شود.'))return;
    if(!by('equipment-password').value){
      const note=by('equipment-recovery-note');note.textContent='برای آزمایش تأیید بازیابی، یک رمز ساختگی دوباره وارد کنید.';by('equipment-password').focus();return;
    }
    clearPassword();busy=true;submit.disabled=true;
    show('نمایشی — در حال شبیه‌سازی بررسی و بازیابی '+port+'…');
    try{
      await delay();
      if(!authorized()||checkedGeneration!==generation)return;
      const texts={
        errdisabled:'نمایشی — پورت '+port+' بازیابی شد؛ در بررسی پس از عملیات دیگر Err-disabled نبود.',
        still:'نمایشی — پورت '+port+' همچنان Err-disabled است؛ در نسخهٔ سرور باید علت خطا بررسی شود.',
        changed:'نمایشی — پورت '+port+' پیش از عملیات دیگر Err-disabled نبود؛ تغییری اعمال نشد.'
      };
      show(texts[scenario],scenario==='still'?'error':'ok');
    }finally{clearPassword();busy=false;submit.disabled=false;}
  };
  by('equipment-demo-scenario').addEventListener('change',reset);
  by('equipment-host').addEventListener('input',reset);
  by('equipment-username').addEventListener('input',reset);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!authorized())return;
    const scenario=by('equipment-demo-scenario').value;
    const checkedGeneration=++generation;
    // Deliberately don't read, copy, retain, transmit or persist the password.
    clearPassword();busy=true;submit.disabled=true;
    show('نمایشی — در حال شبیه‌سازی بررسی وضعیت پورت‌ها؛ بدون اتصال به تجهیز…');
    try{
      await delay();if(!authorized()||checkedGeneration!==generation)return;
      const errors={auth:'نمایشی — نام کاربری یا رمز تجهیز پذیرفته نشد.',timeout:'نمایشی — اتصال SSH در زمان مجاز پاسخ نداد.',connection:'نمایشی — اتصال به تجهیز انجام نشد.'};
      if(errors[scenario]){show(errors[scenario],'error');return;}
      if(scenario==='clean'){
        show('وضعیت پاک (نمایشی): هیچ پورتی با وضعیت Err-disabled وجود ندارد. پورت‌های disabled، connected و notconnect خطا محسوب نمی‌شوند. این نتیجه واقعی نیست.','ok');return;
      }
      show('نمایشی — پورت Err-disabled نمونه یافت شد. برای آزمایش، همان پورت را صریحاً تأیید کنید.','error');
      const list=document.createElement('div');list.className='equipment-ports';
      const row=document.createElement('div');row.className='equipment-port';
      const name=document.createElement('b');name.textContent='Gi0/1';
      const description=document.createElement('span');description.className='equipment-description';description.textContent='ATM 17 — نمونهٔ نمایشی';
      const button=document.createElement('button');button.type='button';button.className='btn btn-amber btn-sm';button.textContent='تأیید رفع خطا';
      button.addEventListener('click',()=>recover('Gi0/1',scenario,checkedGeneration));
      row.append(name,description,button);list.append(row);status.append(list);
      const note=document.createElement('div');note.id='equipment-recovery-note';note.textContent='برای آزمایش بازیابی، رمز ساختگی را دوباره وارد کنید.';status.append(note);
    }finally{clearPassword();busy=false;submit.disabled=false;}
  });
});
