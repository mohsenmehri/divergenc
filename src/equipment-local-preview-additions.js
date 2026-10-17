/* Inserted inside the LOCAL-only port workflow closure by the preview build.
   Manual targets and command output are UI fixtures, never an SSH transport. */
 function descriptionsView(){
  const root=pane?.querySelector('#eq-local-descriptions');if(!root)return;root.replaceChildren();
  root.append(el('h4','','خروجی show int des — نمایشی LOCAL'),el('p','eq-notice warning','متن زیر نمونهٔ ساختگی است، نه خروجی سوئیچ شما. در نسخهٔ متصل به سرور، خروجی همین دستور اینجا نمایش داده می‌شود.'));
  if(!descriptions.length)root.append(el('p','eq-muted','برای نمایش نمونه، IP دستی را وارد کنید یا یک سوئیچ انتخاب کنید.'));
  for(const item of descriptions){const box=el('section','eq-tool-card');box.append(el('h4','',item.node.name+' · '+item.node.host));if(item.error){box.append(el('p','eq-error',item.error));}else{const output=el('pre','eq-local-command-output',item.output);output.dataset.host=item.node.host;output.setAttribute('aria-label','خروجی نمونه show int des برای '+item.node.host);output.dir='ltr';Object.assign(output.style,{whiteSpace:'pre',overflow:'auto',maxHeight:'320px',textAlign:'left',unicodeBidi:'plaintext',fontFamily:'monospace',padding:'16px',border:'1px solid var(--border)',borderRadius:'10px'});box.append(output);}root.append(box);}
 }
 function manualTarget(){
  const id=FamEquipmentLocalTransport.addManual(manualIP.trim());selected=new Set([id]);invalidate();draw();return id;
 }
 async function descriptionsRead(nodes,token){
  const items=[];
  for(const node of nodes){if(token!==epoch)return;try{const data=await FamEquipmentLocalTransport.api('equipment/descriptions',{host:node.host});if(token!==epoch)return;if(data.host!==node.host||data.source!=='local-ui-demo'||typeof data.output!=='string'||data.output.length>100000)throw Error('خروجی نمونه معتبر نیست.');items.push({node:structuredClone(node),output:data.output});}catch(e){items.push({node:structuredClone(node),error:e.message});}}
  if(token===epoch){descriptions=items;descriptionsView();}
 }
 async function showDescriptions(){
  if(busy||descriptionBusy)return;
  try{allowed('equipment-scan');if(!selected.size&&manualIP.trim())manualTarget();const nodes=switches().filter(n=>selected.has(n.id));if(!nodes.length||nodes.length!==selected.size||nodes.length>MAX)throw Error('یک تا پنج سوئیچ انتخاب کنید یا IP خصوصی دستی را وارد کنید.');descriptionBusy=true;const token=epoch;await descriptionsRead(nodes,token);}catch(e){message=e.message;report();}finally{descriptionBusy=false;}
 }
 function manualControls(parent){
  const fieldset=el('fieldset');fieldset.disabled=busy;fieldset.id='eq-local-manual-box';fieldset.append(el('legend','','بررسی و رفع خطا با IP دستی'));
  const label=el('label','eq-field','IP خصوصی سوئیچ'),input=el('input','inp');input.id='eq-local-manual-ip';input.dir='ltr';input.inputMode='decimal';input.maxLength=15;input.placeholder='مثال: 10.2.35.2';input.value=manualIP;input.oninput=()=>{manualIP=input.value;};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run.click();}};label.append(input);
  const run=button('بررسی IP دستی — نمایشی',async()=>{if(busy||descriptionBusy)return;try{allowed('equipment-scan');manualTarget();await scan();}catch(e){message=e.message;report();}},'eq-local-manual-scan');
  const show=button('نمایش خروجی show int des — نمایشی',async()=>{if(busy||descriptionBusy)return;try{allowed('equipment-scan');if(manualIP.trim())manualTarget();await showDescriptions();}catch(e){message=e.message;report();}},'eq-local-show-descriptions');
  run.disabled=show.disabled=!Access.can('equipment-scan');fieldset.append(label,run,show,el('p','eq-notice warning','این نسخه LOCAL اتصال واقعی ندارد. IP فقط برای بررسی رابط است؛ پورت‌ها، خروجی دستور و رفع خطا همگی نمونه‌اند. رفع تنها بعد از انتخاب پورت و تأیید جداگانه نمایش داده می‌شود.'));
  parent.append(fieldset);
 }
