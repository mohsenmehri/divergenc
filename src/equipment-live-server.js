/* Existing bounded real SSH path, intentionally separate from demo tools. */
document.addEventListener('DOMContentLoaded',()=>{
 const box=document.createElement('details');box.id='equipment-live-panel';box.className='eq-tool-card';const title=document.createElement('summary');title.textContent='SSH واقعی — مسیر محدود قبلی (مستقل از ابزارهای نمایشی)';box.append(title);const text=document.createElement('p');text.textContent='این بخش واقعاً به تجهیز وصل می‌شود. فقط IP خصوصی و حساب موقت مجاز؛ نمایش و رفع همان پورت با تأیید صریح، بدون Enable یا ذخیرهٔ تنظیمات.';box.append(text);const content=document.createElement('div');content.innerHTML="<form id=\"live-equipment-check-form\" class=\"live-equipment-form\" autocomplete=\"off\">\n          <div class=\"field\"><label for=\"live-equipment-host\">IP تجهیز</label><input id=\"live-equipment-host\" class=\"inp\" inputmode=\"decimal\" placeholder=\"مثال: 10.2.52.2\" maxlength=\"15\" required></div>\n          <div class=\"field\"><label for=\"live-equipment-username\">نام کاربری SSH / RADIUS</label><input id=\"live-equipment-username\" class=\"inp\" maxlength=\"128\" autocomplete=\"off\" required></div>\n          <div class=\"field\"><label for=\"live-equipment-password\">رمز SSH</label><input id=\"live-equipment-password\" class=\"inp\" type=\"password\" maxlength=\"512\" autocomplete=\"off\" required></div>\n          <button id=\"live-equipment-check-submit\" class=\"btn btn-primary\" type=\"submit\">بررسی وضعیت پورت‌ها</button>\n        </form>\n        <div id=\"live-equipment-status\" class=\"live-equipment-status\" role=\"status\">IP، نام کاربری و رمز را وارد کنید؛ بررسی بلافاصله انجام می‌شود.</div>";box.append(content);document.querySelector('#view-equipment .content').append(box);
 document.addEventListener('fam-access-changed',()=>{box.hidden=!Access.can('equipment-scan');box.querySelectorAll('input').forEach(i=>i.value='');});window.addEventListener('pagehide',()=>box.querySelectorAll('input').forEach(i=>i.value=''));
});

/* Direct Equipment Management: credentials remain only in this document and
   the single HTTPS request/one-shot server helper.  No storage API is used. */
document.addEventListener('DOMContentLoaded',()=>{
  const by=id=>document.getElementById(id), form=by('live-equipment-check-form'), status=by('live-equipment-status');
  if(!form)return;
  const show=(message,type='')=>{status.className='live-equipment-status '+type;status.replaceChildren(document.createTextNode(message));};
  const submit=by('live-equipment-check-submit');
  const values=()=>({host:by('live-equipment-host').value.trim(),username:by('live-equipment-username').value.trim(),password:by('live-equipment-password').value});
  const recover=async(port,ticket)=>{
    if(!Access.require('equipment-repair'))return;
    if(!confirm('رفع Err-disabled فقط روی پورت '+port+' اجرا شود؟\nابتدا وضعیت همین پورت دوباره بررسی می‌شود؛ فقط اگر هنوز err-disabled باشد shutdown / no shutdown روی همان Interface اجرا و سپس دوباره بررسی می‌شود. هیچ تنظیمی ذخیره نخواهد شد.'))return;
    const current=values(); if(!current.password){show('برای تأیید رفع، رمز SSH را دوباره وارد کنید.','error');by('live-equipment-password').focus();return;}
    show('در حال بررسی و رفع کنترل‌شدهٔ '+port+'…');
    try{
      const result=await FamShared.api('equipment/recover',{...current,interface:port,ticket},110000);
      by('live-equipment-password').value='';
      const text={recovered:'پورت '+port+' بازیابی شد و در بررسی پس از عملیات دیگر Err-disabled نبود.',still_errdisabled:'پورت '+port+' همچنان Err-disabled است؛ علت خطا را روی تجهیز بررسی کنید.',not_errdisabled:'پورت '+port+' پیش از اعمال تغییر دیگر Err-disabled نبود؛ تغییری اعمال نشد.'}[result.recovery]||'عملیات پایان یافت.';
      show(text,result.recovery==='recovered'?'ok':'error');
    }catch(error){by('live-equipment-password').value='';show(error.message||'رفع پورت انجام نشد.','error');}
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!Access.require('equipment-scan'))return;
    const current=values(); submit.disabled=true;show('سرور FAM در حال اتصال مستقیم SSH به تجهیز و بررسی وضعیت پورت‌ها است…');
    try{
      const result=await FamShared.api('equipment/check',current,110000), ports=result.errDisabledPorts||[];
      by('live-equipment-password').value='';
      if(!ports.length){show('وضعیت پاک: اتصال SSH برقرار شد و هیچ پورتی با وضعیت Err-disabled روی این تجهیز وجود ندارد. (پورت‌های disabled، connected و notconnect خطا محسوب نمی‌شوند.)','ok');return;}
      status.className='live-equipment-status error';status.replaceChildren(document.createTextNode('پورت‌های Err-disabled یافت شد. برای هر پورت، در صورت تأیید شما فقط همان پورت رفع می‌شود.'));
      const list=document.createElement('div');list.className='live-equipment-ports';
      ports.forEach(port=>{const row=document.createElement('div');row.className='live-equipment-port';const name=document.createElement('b');name.textContent=port.interface;row.append(name);if(port.description){const description=document.createElement('span');description.className='live-equipment-description';description.textContent=port.description;row.append(description)}const button=document.createElement('button');button.type='button';button.className='btn btn-amber btn-sm';button.textContent='تأیید رفع خطا';button.addEventListener('click',()=>recover(port.interface,result.recoveryTickets[port.interface]));row.append(button);list.append(row)});status.append(list);
    }catch(error){by('live-equipment-password').value='';show(error.message||'بررسی تجهیز انجام نشد.','error');}finally{submit.disabled=false;}
  });
});
