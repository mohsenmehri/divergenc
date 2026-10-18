/* LOCAL visual review only. No transport, credentials, device result or config.
   Injected only by build_mac_local_preview.py, never into SERVER or canonical UI. */
window.FamLocalPortPreview=(()=>{
 'use strict';const choices=new Map();let manual=[];
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function mount(parent,nodes){
  const root=el('section','eq-live-workspace');root.id='eq-local-mac-preview';root.append(el('h3','','پیش‌نمایش محلی فرم پورت و تعویض MAC'),el('p','eq-notice warning','فقط بررسی ظاهر و مسیر انتخاب — هیچ اتصال، خواندن binding، رفع خطا یا تغییر تنظیماتی انجام نمی‌شود. رمز تجهیز لازم نیست.'));
  const search=el('input','inp');search.id='eq-local-mac-search';search.placeholder='جست‌وجوی شعبه یا IP';search.setAttribute('aria-label',search.placeholder);
  const list=el('div');list.id='eq-local-mac-switches';const output=el('section');output.id='eq-local-mac-output';output.setAttribute('aria-live','polite');
  const switches=()=>[...nodes,...manual.filter(m=>!nodes.some(n=>n.host===m.host))];
  const invalidate=()=>output.replaceChildren();
  function draw(){list.replaceChildren();for(const node of switches().filter(n=>(n.name+' '+n.host).toLowerCase().includes(search.value.toLowerCase()))){
   const state=choices.get(node.id)||{selected:false,port:'',staticIp:false};choices.set(node.id,state);
   const row=el('div','eq-live-switch-row'),label=el('label','eq-tool-checkbox'),check=el('input');check.type='checkbox';check.checked=state.selected;check.dataset.node=node.id;check.onchange=()=>{state.selected=check.checked;invalidate();};label.append(check,el('span','',node.name+' · '+node.host));
   const portLabel=el('label','eq-field','پورت اختیاری (۱ تا ۲۴)'),port=el('input','inp');port.dataset.port=node.id;port.setAttribute('aria-label','پورت '+node.name);port.dir='ltr';port.inputMode='numeric';port.maxLength=2;port.placeholder='خالی = رفع Err-disabled فعلی';port.value=state.port;portLabel.append(port);
   const staticLabel=el('label','eq-tool-checkbox'),tick=el('input');tick.type='checkbox';tick.dataset.static=node.id;tick.checked=state.staticIp;tick.disabled=!state.port.trim();tick.onchange=()=>{state.staticIp=tick.checked;invalidate();};staticLabel.append(tick,el('span','','IP دستی — همان IP، فقط MAC جدید'));
   port.oninput=()=>{state.port=port.value;tick.disabled=!state.port.trim();if(tick.disabled){state.staticIp=false;tick.checked=false;}invalidate();};row.append(label,portLabel,staticLabel);list.append(row);
  }if(!list.children.length)list.append(el('p','eq-notice','سوئیچی برای نمایش نیست؛ از موجودی یک سوئیچ ثبت کنید یا IP را فقط برای پیش‌نمایش فرم در پایین وارد کنید.'));}
  search.oninput=()=>draw();draw();
  const manualLabel=el('label','eq-field','یا IP سوئیچ فقط برای پیش‌نمایش فرم (در موجودی ذخیره نمی‌شود)'),host=el('input','inp');host.id='eq-local-mac-host';host.dir='ltr';host.maxLength=15;host.placeholder='100.100.1.22';manualLabel.append(host);
  const add=el('button','btn btn-ghost btn-sm','افزودن به فرم پیش‌نمایش');add.type='button';add.id='eq-local-mac-add';add.onclick=()=>{invalidate();const value=host.value.trim();if(!FamEquipmentInventory.privateIP(value)){output.append(el('p','eq-error','IPv4 داخلی مجاز وارد کنید. هیچ اتصالی انجام نمی‌شود.'));return;}const existing=switches().find(n=>n.host===value);if(existing){choices.set(existing.id,{selected:true,port:'',staticIp:false});}else{if(manual.length>=5){output.append(el('p','eq-error','حداکثر پنج IP موقت برای پیش‌نمایش.'));return;}const node={id:'local-preview-'+crypto.randomUUID(),name:'سوئیچ پیش‌نمایش',host:value};manual.push(node);choices.set(node.id,{selected:true,port:'',staticIp:false});}search.value='';draw();};
  const preview=el('button','btn btn-primary btn-sm','نمایش مسیر انتخاب‌شده — بدون اجرا');preview.type='button';preview.id='eq-local-mac-review';preview.onclick=()=>{
   invalidate();const selected=switches().filter(n=>choices.get(n.id)?.selected);if(!selected.length||selected.length>5){output.append(el('p','eq-error','بین یک تا پنج سوئیچ برای پیش‌نمایش انتخاب کنید.'));return;}
   for(const node of selected){const s=choices.get(node.id);if(s.port.trim()&&!/^(?:[1-9]|1[0-9]|2[0-4])$/.test(s.port.trim())){output.append(el('p','eq-error','شمارهٔ پورت باید بین ۱ تا ۲۴ باشد.'));return;}}
   for(const node of selected){const s=choices.get(node.id),card=el('article','eq-tool-card');card.append(el('h4','',node.name+' · '+node.host));
    if(!s.port.trim())card.append(el('p','', 'پورت خالی: در SERVER همان بررسی و رفع Err-disabled فعلی، پس از انتخاب پورت خطادار و تأیید کارشناس انجام خواهد شد.'));
    else{card.append(el('p','', 'پورت انتخاب‌شده: Fa0/'+s.port.trim()),el('p','',s.staticIp?'IP دستی: IP و MAC قبلی از binding همان پورت خوانده خواهند شد. IP جدید وارد یا از شمارهٔ پورت ساخته نمی‌شود.':'بدون تیک دستی: هیچ رکورد ثابت source binding یا ARP ACL تغییر نخواهد کرد.'));
     const steps=el('ol');for(const text of ['پیش‌بررسی و تأیید جداگانهٔ پورت و مجازبودن دستگاه جدید','بستن پورت و برداشتن موقت IPSG',...(s.staticIp?['حذف فقط binding و permit قدیمی Inspection برای همان IP/MAC']:[]),'بازکردن پورت؛ بررسی خطای احتمالی و یادگیری یک MAC جدید',...(s.staticIp?['ثبت همان IP در binding و Inspection با MAC جدید؛ IP بدون تغییر']:[]),'بازگرداندن IPSG و بررسی وضعیت لینک'])steps.append(el('li','',text));card.append(steps,el('p','eq-notice warning','Sticky/Configured قبلی خودکار حذف نمی‌شود. در شکست، پورت ممکن است بسته بماند؛ قطع SSH می‌تواند وضعیت حفاظت را نامشخص کند. اینجا هیچ‌یک از این مراحل اجرا نشده است.'));}
    card.append(el('p','eq-muted','پیش‌نمایش مسیر، نه نتیجهٔ بررسی سوئیچ.'));output.append(card);
   }
  };
  root.append(search,list,manualLabel,add,preview,output);parent.append(root);
 }
 document.addEventListener('fam-access-changed',()=>{choices.clear();manual=[];});window.addEventListener('pagehide',()=>{choices.clear();manual=[];});
 return Object.freeze({mount});
})();
