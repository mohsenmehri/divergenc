/* Injected only into the real SERVER controller closure. Device credentials,
   manual targets, review tickets and description tables remain in document RAM. */
 function addManual(host){
  if(!FamEquipmentInventory.privateIP(host))throw Error('فقط IPv4 خصوصی معتبر وارد کنید؛ مثال 10.2.35.2.');
  const data=inventory(),known=data.nodes.find(n=>n.host===host);
  if(known){if(!data.catalog.types.some(t=>t.id===known.typeId&&t.kind==='switch'))throw Error('IP موجودی انتخاب‌شده متعلق به سوئیچ نیست.');return known.id;}
  const previous=manualTargets.find(n=>n.host===host);if(previous)return previous.id;
  if(!['types','models','regions','siteKinds','sites'].every(k=>Access.current()?.equipmentScope?.[k]?.includes('*')))throw Error('IP دستی باید در موجودی مجاز شما ثبت شده باشد؛ مدیر باید محدوده را بررسی کند.');
  if(manualTargets.length>=MAX)manualTargets.shift();const node={id:'manual-'+crypto.randomUUID(),name:'IP دستی '+host,host};manualTargets.push(node);return node.id;
 }
 function manualTarget(){const id=addManual(manualIP.trim());selected=new Set([id]);invalidate();draw();return id;}
 function descriptionsView(){
  const root=pane?.querySelector('#eq-live-descriptions');if(!root)return;root.replaceChildren();root.append(el('h4','','خروجی show int des'),el('p','eq-muted','خروجی دستور ثابت show interfaces description با حفظ سطرها و فاصله‌ها؛ بنر، prompt و اطلاعات حساس نمایش داده نمی‌شوند.'));
  if(!descriptions.length)root.append(el('p','eq-muted','پس از بررسی موفق، خروجی اینجا نمایش داده می‌شود؛ دکمهٔ مستقل نمایش خروجی هم در دسترس است.'));
  for(const item of descriptions){const card=el('section','eq-tool-card');card.append(el('h4','',item.node.name+' · '+item.node.host));if(item.error)card.append(el('p','eq-error',item.error));else{if(item.redacted)card.append(el('p','eq-notice warning','بخش حساس توضیحات با [REDACTED] پوشانده شده است.'));const pre=el('pre','eq-live-command-output',item.output);pre.dataset.host=item.node.host;pre.dir='ltr';pre.setAttribute('aria-label','خروجی show int des برای '+item.node.host);Object.assign(pre.style,{whiteSpace:'pre',overflow:'auto',maxHeight:'360px',textAlign:'left',unicodeBidi:'plaintext',fontFamily:'monospace',padding:'16px',border:'1px solid var(--border)',borderRadius:'10px'});card.append(pre);}root.append(card);}
 }
 async function descriptionsRead(nodes,token){
  const items=[];
  for(const node of nodes){if(token!==epoch||!valid())return;try{allowed('equipment-scan');const data=await FamShared.api('equipment/descriptions',{host:node.host,username:auth.username.trim(),password:auth.password},110000);if(token!==epoch||!valid())return;if(data.host!==node.host||data.source!=='server-ssh'||data.command!=='show interfaces description'||!Number.isFinite(data.checkedAt)||typeof data.output!=='string'||data.output.length>100000)throw Error('خروجی دستور قابل تأیید نیست.');items.push({node:structuredClone(node),output:data.output,redacted:data.redacted===true});}catch(error){if(token!==epoch)return;items.push({node:structuredClone(node),error:error.message});if(error.status===401||error.status===403)break;}}
  if(token===epoch){descriptions=items;descriptionsView();}
 }
 async function showDescriptions(){
  if(busy||descriptionBusy)return;
  try{allowed('equipment-scan');if(!auth.username.trim()||!auth.password)throw Error('نام کاربری و رمز ورود سوئیچ را وارد کنید.');if(!selected.size&&manualIP.trim())manualTarget();const nodes=switches().filter(n=>selected.has(n.id));if(!nodes.length||nodes.length!==selected.size||nodes.length>MAX)throw Error('یک تا پنج سوئیچ مجاز انتخاب کنید یا IP خصوصی دستی را وارد کنید.');
   invalidate();signature=stamp();busy=true;descriptionBusy=true;const token=epoch;message='سرور FAM در حال اجرای show interfaces description با SSH است…';draw();
   try{await descriptionsRead(nodes,token);}finally{busy=false;descriptionBusy=false;message=token===epoch?'دریافت خروجی پایان یافت؛ خطای دریافت، جداگانه کنار هر سوئیچ نمایش داده می‌شود.':'دریافت متوقف شد؛ نتیجه‌ای تأیید نشده است.';draw();}
  }catch(error){message=error.message;report();}
 }
 function manualControls(parent){
  const fieldset=el('fieldset');fieldset.disabled=busy;fieldset.id='eq-live-manual-box';fieldset.append(el('legend','','بررسی و رفع خطا با IP دستی'));
  const label=el('label','eq-field','IP خصوصی سوئیچ'),input=el('input','inp');input.id='eq-live-manual-ip';input.dir='ltr';input.inputMode='decimal';input.maxLength=15;input.value=manualIP;input.placeholder='مثال: 10.2.35.2';input.oninput=()=>{manualIP=input.value;};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run.click();}};label.append(input);
  const run=button('بررسی IP دستی',async()=>{if(busy||descriptionBusy)return;try{allowed('equipment-scan');manualTarget();await scan();}catch(error){message=error.message;report();}},'eq-live-manual-scan');
  const show=button('نمایش خروجی show int des',async()=>{if(busy||descriptionBusy)return;try{allowed('equipment-scan');if(manualIP.trim())manualTarget();await showDescriptions();}catch(error){message=error.message;report();}},'eq-live-show-descriptions');run.disabled=show.disabled=!Access.can('equipment-scan');
  fieldset.append(label,run,show,el('p','eq-muted','از همان نام کاربری و رمز سوئیچ در بالا استفاده می‌شود. اتصال از سرور FAM است؛ IP دستی ذخیره نمی‌شود. رفع فقط بعد از انتخاب پورت و تأیید جداگانه انجام می‌شود.'));parent.append(fieldset);
 }
