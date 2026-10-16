/* Local-only Equipment UI. Canonical nodes + derived facets; RADIUS in closure RAM only. */
document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('equipment-workspace');if(!root)return;
  const M=FamEquipmentInventory,KEY='fam.equipment.inventory.v3',OLD_KEY='fam.equipment.inventory.v2',CARDS_KEY='fam.equipment.cards.v1';
  let inventory=M.defaults(),storageIssue='',migrationNote='',credentials=null,path={},activeDialog=null,epoch=0;
  let scenario='clean',result=null,tab='overview',search='',busy=false,facet='overview',filters={},activeField=null,onlyReview=false;
  let cardSettings=M.defaultCards(),cardsIssue='',groupIssue='',workspaceTab='inventory';
  const checks=new Map(),uid=()=>crypto.randomUUID();
  const can=()=>typeof Access!=='undefined'&&Access.can('equipment');
  const configuration=FamEquipmentConfiguration.create({getInventory:()=>inventory,isAuthorized:()=>!!credentials&&can()&&credentials.userId===Access.current()?.id});
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,handler,cls='btn btn-ghost btn-sm')=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',handler);return n;};
  const tools=(...buttons)=>{const n=el('div','eq-tools');n.append(...buttons);return n;};
  const notice=(text,cls='')=>el('div','eq-notice '+cls,text);
  function heading(title,sub){const n=el('div','eq-heading');n.append(el('h3','',title),el('p','',sub));return n;}
  function metric(value,label){const n=el('div','eq-metric');n.append(el('strong','',String(value)),el('span','',label));return n;}
  const catalog=(key)=>inventory.catalog[key];
  const find=(key,id)=>catalog(key).find(item=>item.id===id);
  const nameOf=(key,id)=>find(key,id)?.name||'تعیین نشده';
  const lookup={typeId:'types',modelId:'models',regionId:'regions',siteKindId:'siteKinds',siteId:'sites'};
  const selected=()=>{const node=inventory.nodes.find(n=>n.id===path.node);return {node,type:find('types',node?.typeId),model:find('models',node?.modelId),region:find('regions',node?.regionId),siteKind:find('siteKinds',node?.siteKindId),site:find('sites',node?.siteId)};};
  function load(){
    try{
      const raw=localStorage.getItem(KEY);
      if(raw){inventory=M.validate(JSON.parse(raw));return;}
      const old=localStorage.getItem(OLD_KEY);
      if(old){inventory=M.migrateV2(JSON.parse(old));localStorage.setItem(KEY,JSON.stringify(inventory));migrationNote='فهرست قبلی بدون حذف منتقل شد. مدل، منطقه یا محل نامشخص را در «نیازمند تکمیل» مشخص کنید؛ نسخهٔ قبلی دست‌نخورده باقی مانده است.';}
    }catch(e){storageIssue='فهرست محلی قابل خواندن یا ذخیره نیست؛ برای حفظ اطلاعات، تغییرات غیرفعال است. داده‌های مرورگر را پاک نکنید.';}
  }
  function loadCards(){
    try{const raw=localStorage.getItem(CARDS_KEY);if(raw!==null)cardSettings=M.validateCards(JSON.parse(raw));}
    catch(e){cardsIssue='تنظیمات کارت‌ها قابل خواندن نیست؛ برای حفظ اطلاعات، ویرایش کارت‌ها غیرفعال است. دسته‌ها و نودها حذف نشده‌اند.';}
  }
  function saveCards(next){
    if(!can()||!credentials||credentials.userId!==Access.current()?.id)throw Error('دوباره وارد بخش تجهیزات شوید.');
    if(cardsIssue)throw Error(cardsIssue);
    const clean=M.validateCards(next);
    try{localStorage.setItem(CARDS_KEY,JSON.stringify(clean));}catch(e){throw Error('تنظیمات کارت ذخیره نشد؛ فضای ذخیره‌سازی مرورگر را بررسی کنید.');}
    cardSettings=clean;
  }
  function save(next){
    if(!can()||!credentials||credentials.userId!==Access.current()?.id)throw Error('دوباره وارد بخش تجهیزات شوید.');
    if(storageIssue)throw Error(storageIssue);
    const clean=M.validate(next);localStorage.setItem(KEY,JSON.stringify(clean));inventory=clean;groupIssue='';
    for(const [field,key]of Object.entries(lookup))if(filters[field]&&!find(key,filters[field])){delete filters[field];if(activeField===field)activeField=null;}
  }
  const navigate=next=>{epoch++;path=next;result=null;tab='overview';busy=false;render();};
  function lock(){
    epoch++;credentials=null;path={};result=null;busy=false;checks.clear();configuration.clear();workspaceTab='inventory';
    activeDialog?.close();activeDialog?.remove();activeDialog=null;
    root.querySelectorAll('input[type=password]').forEach(n=>{n.value='';});render();
  }
  function icon(kind){
    const box=el('span','eq-device-icon');box.setAttribute('aria-hidden','true');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);
    const shapes={router:[['circle',{cx:12,cy:12,r:9}],['path',{d:'M8 8h8v8M16 8l-8 8M4 12h3M17 12h3'}]],switch:[['rect',{x:2,y:5,width:20,height:14,rx:3}],['path',{d:'M6 10h2M11 10h2M16 10h2M6 14h2M11 14h2M16 14h2'}]],branch:[['path',{d:'M12 21s7-5 7-12a7 7 0 0 0-14 0c0 7 7 12 7 12Z'}],['circle',{cx:12,cy:9,r:2.5}]],building:[['path',{d:'M4 21V7h9v14M13 11h7v10M2 21h20M7 10h3M7 14h3M7 18h3M16 14h1M16 18h1M7 7V3h9v8'}]],datacenter:[['rect',{x:4,y:3,width:16,height:7,rx:2}],['rect',{x:4,y:14,width:16,height:7,rx:2}],['path',{d:'M8 6.5h.01M11 6.5h5M8 17.5h.01M11 17.5h5M12 10v4'}]],other:[['path',{d:'m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5'}]]};
    for(const [tag,attrs]of shapes[kind]||shapes.other){const shape=document.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))shape.setAttribute(key,value);svg.append(shape);}box.append(svg);return box;
  }
  function gate(){
    const card=el('article','eq-gate');
    const mark=el('div','eq-gate-mark','R');mark.setAttribute('aria-hidden','true');
    card.append(mark,el('div','eq-eyebrow','EQUIPMENT ACCESS'),heading('ورود به مدیریت تجهیزات','ابتدا اطلاعات RADIUS را وارد کنید؛ سپس نوع تجهیز و محل استقرار را انتخاب کنید.'));
    const form=el('form','eq-auth-form');form.autocomplete='off';
    for(const [id,label,type] of [['equipment-radius-user','نام کاربری RADIUS','text'],['equipment-radius-password','رمز RADIUS','password']]){
      const field=el('label','eq-field',label),input=el('input','inp');input.id=id;input.type=type;input.required=true;input.maxLength=type==='password'?512:128;input.autocomplete=type==='password'?'new-password':'off';input.dir='ltr';field.append(input);form.append(field);
    }
    const error=el('div','eq-error');error.setAttribute('role','alert');
    const submit=el('button','btn btn-primary','ورود به فضای تجهیزات');submit.type='submit';
    form.append(error,submit);
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!can())return;
      const user=form.querySelector('#equipment-radius-user'),password=form.querySelector('#equipment-radius-password');
      if(!user.value.trim()||!password.value){error.textContent='نام کاربری و رمز RADIUS را وارد کنید.';return;}
      credentials={userId:Access.current().id,username:user.value.trim(),password:password.value};password.value='';user.value='';path={};render();
    });
    card.append(form,notice('پیش‌نمایش محلی: فقط اطلاعات ساختگی وارد کنید. این مرحله احراز هویت واقعی RADIUS نیست. رمز ذخیره یا ارسال نمی‌شود.','warning'),el('p','eq-muted','پیش‌فرض: RADIUS · مسیر حساب Local و Enable در مرحلهٔ بعد طراحی می‌شود و فعلاً اجرا نمی‌شود.'));
    root.append(card);
  }
  function selectField(form,id,label,items,value='',required=true){
    const wrap=el('label','eq-field',label),select=el('select','inp');select.id=id;select.required=required;
    const placeholder=el('option','',required?'انتخاب کنید…':'همه');placeholder.value='';select.append(placeholder);
    for(const item of items){const option=el('option','',item.name);option.value=item.id;select.append(option);}select.value=value||'';wrap.append(select);form.append(wrap);return select;
  }
  function textField(form,id,label,value='',maxLength=80){
    const wrap=el('label','eq-field',label),input=el('input','inp');input.id=id;input.value=value;input.maxLength=maxLength;input.required=true;wrap.append(input);form.append(wrap);return {input,wrap};
  }
  function dialogShell(title,description,wide=false){
    const dialog=el('dialog','eq-dialog'+(wide?' eq-dialog-wide':''));activeDialog=dialog;
    const close=()=>{dialog.close();dialog.remove();activeDialog=null;};
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.append(heading(title,description));document.body.append(dialog);return {dialog,close};
  }
  function editNode(node=null){
    if(!can()||storageIssue)return;
    const initial=node||{...filters};
    if(initial.modelId&&!initial.typeId)initial.typeId=find('models',initial.modelId)?.typeId;
    if(initial.siteId&&!initial.siteKindId)initial.siteKindId=find('sites',initial.siteId)?.siteKindId;
    const {dialog,close}=dialogShell(node?'ویرایش نود':'افزودن نود','همهٔ مشخصات را انتخاب کنید؛ عضویت در دسته‌ها خودکار است. هیچ رمز عبوری ذخیره نمی‌شود.',true);
    const form=el('form','eq-editor eq-node-editor');form.autocomplete='off';
    const grid=el('div','eq-node-fields');
    const name=textField(grid,'eq-edit-name','نام نود',node?.name||'').input;
    const host=textField(grid,'eq-edit-host','IP خصوصی تجهیز',node?.host||'',15).input;host.dir='ltr';host.placeholder='10.2.35.2';
    const type=selectField(grid,'eq-node-type','نوع تجهیز',catalog('types'),initial.typeId);
    const model=selectField(grid,'eq-node-model','مدل تجهیز',[],initial.modelId);
    const newModel=textField(grid,'eq-node-new-model','نام مدل جدید');newModel.wrap.hidden=true;newModel.input.required=false;
    const region=selectField(grid,'eq-node-region','منطقه',catalog('regions'),initial.regionId);
    const siteKind=selectField(grid,'eq-node-site-kind','نوع محل استقرار',catalog('siteKinds'),initial.siteKindId);
    const site=selectField(grid,'eq-node-site','نام شعبه / ساختمان / دیتا سنتر',[],initial.siteId);
    const newSite=textField(grid,'eq-node-new-site','نام محل جدید');newSite.wrap.hidden=true;newSite.input.required=false;
    const repopulate=(select,items,value,extra)=>{select.replaceChildren();const o=el('option','','انتخاب کنید…');o.value='';select.append(o);for(const item of [...items,{id:'__new__',name:extra}]){const o=el('option','',item.name);o.value=item.id;select.append(o);}select.value=items.some(i=>i.id===value)?value:'';};
    const toggleNew=(select,field)=>{field.wrap.hidden=select.value!=='__new__';field.input.required=!field.wrap.hidden;};
    const models=value=>{repopulate(model,catalog('models').filter(m=>m.typeId===type.value),value,'＋ تعریف مدل جدید');model.disabled=!type.value;toggleNew(model,newModel);};
    const sites=value=>{repopulate(site,catalog('sites').filter(s=>s.siteKindId===siteKind.value),value,'＋ تعریف محل جدید');site.disabled=!siteKind.value;toggleNew(site,newSite);};
    models(initial.modelId);sites(initial.siteId);
    type.addEventListener('change',()=>models(null));siteKind.addEventListener('change',()=>sites(null));
    model.addEventListener('change',()=>toggleNew(model,newModel));site.addEventListener('change',()=>toggleNew(site,newSite));
    const error=el('div','eq-error');error.setAttribute('role','alert');
    const submit=el('button','btn btn-primary','ذخیره نود');submit.type='submit';
    form.append(grid,notice('یک نود، چند دسته: مثلاً Router / 1841 / منطقه ۱ / ساختمان مرکزی رضوان. تغییر مشخصات، دسته‌ها را خودکار به‌روز می‌کند.'),error,tools(submit,button('انصراف',close)));
    form.addEventListener('submit',event=>{
      event.preventDefault();try{
        if(!M.privateIP(host.value.trim()))throw Error('فقط IPv4 خصوصی معتبر وارد کنید.');
        const next=structuredClone(inventory);
        const define=(key,label,parent)=>{
          const name=label.trim();if(!M.validName(name))throw Error('نام معتبر برای مدل یا محل جدید وارد کنید.');
          let item=next.catalog[key].find(item=>item.name===name&&Object.entries(parent).every(([k,v])=>item[k]===v));
          if(!item){item={id:uid(),name,...parent};next.catalog[key].push(item);}return item.id;
        };
        const modelId=model.value==='__new__'?define('models',newModel.input.value,{typeId:type.value}):model.value;
        const siteId=site.value==='__new__'?define('sites',newSite.input.value,{siteKindId:siteKind.value}):site.value;
        const item={id:node?.id||uid(),name:name.value.trim(),host:host.value.trim(),typeId:type.value,modelId,regionId:region.value,siteKindId:siteKind.value,siteId,...(node?.legacyPath?{legacyPath:node.legacyPath}:{})};
        save(M.upsertNode(next,item));checks.delete(item.id);close();result=null;render();
      }catch(e){error.textContent=e.name==='QuotaExceededError'?'فضای مرورگر کافی نیست؛ هیچ تغییری ذخیره نشد.':e.message;}
    });
    dialog.append(form);dialog.showModal();name.focus();
  }
  function manageCatalog(initialKey='types',initialItem=null,preset={}){
    if(!can()||storageIssue)return;
    const {dialog,close}=dialogShell('مدیریت دسته‌بندی‌ها','نوع‌ها، مدل‌ها، مناطق و محل‌ها را خودتان تعریف کنید. دستهٔ استفاده‌شده بدون تعیین تکلیف نودها حذف نمی‌شود.',true);
    const shell=el('div','eq-catalog-shell'),keySelect=selectField(shell,'eq-catalog-dimension','بخش موردنظر',Object.entries(M.dimensions).map(([id,name])=>({id,name})),initialKey);
    keySelect.options[0].disabled=true;
    const body=el('div','eq-catalog-body');shell.append(body);
    function draw(target=null){
      body.replaceChildren();const key=keySelect.value,editor=el('form','eq-editor'),list=el('div','eq-catalog-list');
      const name=textField(editor,'eq-catalog-name','نام '+M.dimensions[key],target?.name||'').input;
      let parent=null,kind=null;
      if(key==='models')parent=selectField(editor,'eq-catalog-parent','نوع تجهیز',catalog('types'),target?.typeId||preset.typeId);
      if(key==='sites')parent=selectField(editor,'eq-catalog-parent','نوع محل',catalog('siteKinds'),target?.siteKindId||preset.siteKindId);
      if(key==='types'||key==='siteKinds')kind=selectField(editor,'eq-catalog-kind','الگوی نمایش',key==='types'?[{id:'router',name:'روتر'},{id:'switch',name:'سوئیچ'},{id:'other',name:'سایر'}]:[{id:'branch',name:'شعبه'},{id:'building',name:'ساختمان'},{id:'datacenter',name:'دیتا سنتر'},{id:'other',name:'سایر'}],target?.kind||preset.kind||'other');
      const error=el('div','eq-error');error.setAttribute('role','alert');const submit=el('button','btn btn-primary',target?'ذخیره تغییرات':'افزودن دسته');submit.type='submit';
      editor.append(error,tools(submit,button('فرم جدید',()=>draw())));
      editor.addEventListener('submit',event=>{event.preventDefault();try{
        if(!M.validName(name.value.trim()))throw Error('نام معتبر وارد کنید.');
        const next=structuredClone(inventory),item={id:target?.id||uid(),name:name.value.trim()};
        if(parent)item[key==='models'?'typeId':'siteKindId']=parent.value;if(kind)item.kind=kind.value;
        const index=next.catalog[key].findIndex(n=>n.id===item.id);if(index<0)next.catalog[key].push(item);else next.catalog[key][index]=item;
        save(next);draw();render();
      }catch(e){error.textContent=e.message;}});
      for(const item of catalog(key)){
        const row=el('div','eq-catalog-row'),label=el('div');label.append(el('strong','',item.name));
        if(item.typeId||item.siteKindId)label.append(el('span','eq-muted',nameOf(item.typeId?'types':'siteKinds',item.typeId||item.siteKindId)));
        const edit=button('ویرایش',()=>draw(item),'eq-mini-action');edit.setAttribute('aria-label','ویرایش '+item.name);
        const remove=button('حذف',()=>{if(!confirm('دستهٔ «'+item.name+'» حذف شود؟ نودها حذف نمی‌شوند.'))return;try{save(M.removeCategory(inventory,key,item.id));draw();render();}catch(e){error.textContent=e.message;}},'eq-mini-action eq-danger');remove.setAttribute('aria-label','حذف '+item.name);
        row.append(label,tools(edit,remove));list.append(row);
      }
      if(!catalog(key).length)list.append(notice('هنوز موردی تعریف نشده است.'));body.append(editor,list);
    }
    keySelect.addEventListener('change',()=>draw());dialog.append(shell,tools(button('بستن',close)));draw(initialItem);dialog.showModal();
  }
  function groupCatalogKey(){return ['buildings','datacenters'].includes(facet)?'sites':facet;}
  function groupPreset(){
    if(facet==='models')return {typeId:filters.typeId};
    if(facet==='buildings'||facet==='datacenters')return {siteKindId:catalog('siteKinds').find(item=>item.kind===(facet==='buildings'?'building':'datacenter'))?.id};
    return {};
  }
  function removeGroup(key,item){
    if(!confirm('دستهٔ «'+item.name+'» حذف شود؟ نودها حذف نمی‌شوند؛ دستهٔ دارای نود یا زیرمجموعه قابل حذف نیست.'))return;
    try{save(M.removeCategory(inventory,key,item.id));render();}
    catch(e){groupIssue=e.name==='QuotaExceededError'?'دسته حذف نشد؛ فضای ذخیره‌سازی مرورگر کافی نیست.':e.message;render();}
  }
  function removeNode(node){
    if(!confirm('نود «'+node.name+'» از کل فهرست و همهٔ دسته‌ها حذف شود؟ این کار روی تجهیز واقعی اثری ندارد.'))return;
    try{save({...inventory,nodes:inventory.nodes.filter(n=>n.id!==node.id)});checks.delete(node.id);if(path.node===node.id)path={};render();}catch(e){alert(e.message);}
  }
  function removeMembership(node,field){
    const label=nameOf(lookup[field],node[field]);
    if(!confirm('«'+node.name+'» فقط از دستهٔ «'+label+'» خارج شود؟ خود نود حذف نمی‌شود و در «نیازمند تکمیل» باقی می‌ماند.'))return;
    try{save(M.unassign(inventory,node.id,field));render();}catch(e){alert(e.message);}
  }
  function applyFilter(field,id){
    if(id)filters[field]=id;else delete filters[field];activeField=id?field:null;onlyReview=false;path={};search='';
    if(field==='typeId'&&filters.modelId&&find('models',filters.modelId)?.typeId!==id)delete filters.modelId;
    if(field==='modelId'&&id)filters.typeId=find('models',id).typeId;
    if(field==='siteKindId'&&filters.siteId&&find('sites',filters.siteId)?.siteKindId!==id)delete filters.siteId;
    if(field==='siteId'&&id)filters.siteKindId=find('sites',id).siteKindId;
    navigate({});
  }
  const facets=[['overview','همهٔ نودها','other'],['types','نوع تجهیز','router'],['models','مدل تجهیز','switch'],['regions','منطقه','branch'],['siteKinds','نوع محل','building'],['buildings','ساختمان‌ها','building'],['datacenters','دیتا سنتر','datacenter']];
  function cardTargets(key){
    if(key==='buildings'||key==='datacenters')return catalog('sites').filter(item=>find('siteKinds',item.siteKindId)?.kind===(key==='buildings'?'building':'datacenter'));
    return catalog(key);
  }
  function cardTarget(card){return card.refId?cardTargets(card.facet).find(item=>item.id===card.refId):null;}
  function openCard(card){
    if(card.refId&&!cardTarget(card)){editCard(card);return;}
    filters={};activeField=null;onlyReview=false;search='';facet=card.facet;
    if(card.refId)applyFilter(M.cardFields[card.facet],card.refId);else navigate({});
  }
  function editCard(card=null){
    if(!can()||!credentials||cardsIssue)return;
    const {dialog,close}=dialogShell(card?'ویرایش کارت':'افزودن کارت','این کارت فقط میان‌بُر نمایش است؛ تغییر یا حذف آن، دسته‌ها و نودها را حذف نمی‌کند.');
    const form=el('form','eq-editor eq-card-editor');
    const name=textField(form,'eq-card-name','نام کارت',card?.name||'').input;
    const axis=selectField(form,'eq-card-axis','نمایش بر اساس',facets.slice(1).map(([id,name])=>({id,name})),card?.facet||'types');axis.options[0].disabled=true;
    const target=selectField(form,'eq-card-target','دستهٔ مشخص (اختیاری)',[],null,false);
    const populate=ref=>{
      target.replaceChildren();const all=el('option','','همهٔ دسته‌های این بخش');all.value='';target.append(all);
      for(const item of cardTargets(axis.value)){const option=el('option','',item.name+(item.typeId?' · '+nameOf('types',item.typeId):''));option.value=item.id;target.append(option);}
      if(ref&&!cardTargets(axis.value).some(item=>item.id===ref)){const missing=el('option','','دستهٔ قبلی حذف شده؛ مقصد جدید انتخاب کنید');missing.value=ref;target.append(missing);}
      target.value=ref||'';
    };
    populate(card?.refId);axis.addEventListener('change',()=>populate(null));
    const error=el('div','eq-error');error.setAttribute('role','alert');const submit=el('button','btn btn-primary','ذخیره کارت');submit.type='submit';
    form.append(error,tools(submit,button('انصراف',close)));
    form.addEventListener('submit',event=>{event.preventDefault();try{
      if(target.value&&!cardTargets(axis.value).some(item=>item.id===target.value))throw Error('مقصد کارت در دسترس نیست؛ یک مقصد معتبر انتخاب کنید.');
      const next=structuredClone(cardSettings),item={id:card?.id||uid(),name:name.value.trim(),facet:axis.value,refId:target.value||null};
      const index=next.cards.findIndex(c=>c.id===item.id);if(index<0)next.cards.push(item);else next.cards[index]=item;
      saveCards(next);close();render();
    }catch(e){error.textContent=e.message;}});
    dialog.append(form);dialog.showModal();name.focus();
  }
  function deleteCard(card){
    if(!confirm('فقط کارت «'+card.name+'» حذف شود؟ دسته‌ها و تمام نودها باقی می‌مانند.'))return;
    try{saveCards({...cardSettings,cards:cardSettings.cards.filter(c=>c.id!==card.id)});render();}catch(e){alert(e.message);}
  }
  function groupItems(){
    if(facet==='overview')return [];
    if(['buildings','datacenters'].includes(facet)){
      const kind=facet==='buildings'?'building':'datacenter';return catalog('sites').filter(s=>find('siteKinds',s.siteKindId)?.kind===kind).map(item=>({item,field:'siteId',count:inventory.nodes.filter(n=>n.siteId===item.id).length}));
    }
    const field={types:'typeId',models:'modelId',regions:'regionId',siteKinds:'siteKindId'}[facet];
    return catalog(facet).filter(item=>facet!=='models'||!filters.typeId||item.typeId===filters.typeId).map(item=>({item,field,count:inventory.nodes.filter(n=>n[field]===item.id).length}));
  }
  function filtersBar(){
    const bar=el('div','eq-filters');
    for(const [field,key,title]of [['typeId','types','نوع تجهیز'],['modelId','models','مدل تجهیز'],['regionId','regions','منطقه'],['siteKindId','siteKinds','نوع محل'],['siteId','sites','محل استقرار']]){
      const items=catalog(key).filter(item=>key==='models'?!filters.typeId||item.typeId===filters.typeId:key==='sites'?!filters.siteKindId||item.siteKindId===filters.siteKindId:true);
      const select=selectField(bar,'eq-filter-'+field,title,items,filters[field],false);select.addEventListener('change',()=>applyFilter(field,select.value));
    }
    return bar;
  }
  function table(rows,container){
    const wrap=el('div','eq-table-wrap'),table=el('table','eq-table');table.setAttribute('aria-label','فهرست نودها');
    const head=el('thead'),hr=el('tr');for(const title of ['نام و IP','نوع / مدل','منطقه','محل استقرار','وضعیت','مدیریت'])hr.append(el('th','',title));head.append(hr);table.append(head);
    const body=el('tbody');
    for(const node of rows){
      const tr=el('tr'),name=el('td'),link=button(node.name,()=>{navigate({node:node.id});runCheck();},'eq-node-link');name.append(link,el('span','eq-node-sub eq-mono',node.host));
      const type=el('td');type.append(el('span','',nameOf('types',node.typeId)),el('span','eq-node-sub',nameOf('models',node.modelId)));
      const region=el('td','',nameOf('regions',node.regionId)),site=el('td');site.append(el('span','',nameOf('sites',node.siteId)),el('span','eq-node-sub',nameOf('siteKinds',node.siteKindId)));
      const status=el('td');status.append(el('span','eq-badge',M.incomplete(node)?'نیازمند تکمیل':checks.has(node.id)?'بررسی نمایشی شد':'بررسی نشده'));
      const actions=el('td'),buttons=tools(button('ویرایش',()=>editNode(node)),button('حذف نود',()=>removeNode(node),'btn btn-ghost btn-sm eq-danger'));
      if(activeField&&filters[activeField]===node[activeField])buttons.append(button('حذف از دسته',()=>removeMembership(node,activeField)));
      actions.append(buttons);tr.append(name,type,region,site,status,actions);body.append(tr);
    }
    if(!rows.length){const row=el('tr'),cell=el('td','eq-empty','نودی در این انتخاب وجود ندارد. «افزودن نود» مشخصات همین دسته را از قبل انتخاب می‌کند.');cell.colSpan=6;row.append(cell);body.append(row);}
    table.append(body);wrap.append(table);container.append(wrap);
  }
  function inventoryView(main){
    const hero=el('div','eq-hero'),copy=el('div','eq-hero-copy');copy.append(el('div','eq-eyebrow','SMART DEVICE GROUPS'),heading('یک نود؛ چند دستهٔ خودکار','نوع، مدل، منطقه و محل را انتخاب کنید؛ نود در همهٔ دسته‌های مرتبط دیده می‌شود.'));
    const stats=el('div','eq-metrics');stats.append(metric(inventory.nodes.length,'نود یکتا'),metric(inventory.nodes.filter(M.incomplete).length,'نیازمند تکمیل'));hero.append(copy,stats);main.append(hero);
    main.append(tools(button('＋ افزودن نود',()=>editNode(),'btn btn-primary btn-sm'),button('مدیریت دسته‌ها',()=>manageCatalog()),button('پیکربندی این انتخاب',()=>{configuration.useSelection(filters);workspaceTab='configuration';navigate({});}),button('نیازمند تکمیل ('+inventory.nodes.filter(M.incomplete).length+')',()=>{onlyReview=!onlyReview;if(onlyReview){filters={};activeField=null;}path={};render();},'btn btn-ghost btn-sm'+(onlyReview?' eq-active-filter':''))));
    const nav=el('nav','eq-type-nav eq-facet-nav');nav.setAttribute('aria-label','روش دسته‌بندی');
    for(const [key,label,kind]of facets){const b=button('',()=>{facet=key;render();},'eq-tree-link'+(facet===key?' selected':''));b.append(icon(kind),el('span','',label));nav.append(b);}main.append(nav);
    if(facet==='overview'){
      const toolbar=el('div','eq-cards-toolbar');toolbar.append(el('h4','','کارت‌های من'));
      const add=button('＋ افزودن کارت',()=>editCard());add.disabled=!!cardsIssue;toolbar.append(add);main.append(toolbar);
      const cards=el('div','eq-card-grid eq-smart-cards');
      for(const item of cardSettings.cards){
        const [,,kind]=facets.find(f=>f[0]===item.facet),card=el('article','eq-card tone-'+kind),go=button('',()=>openCard(item),'eq-card-main');
        go.setAttribute('aria-label','باز کردن '+item.name);
        const title=el('div','eq-shortcut-title');title.append(icon(kind),el('strong','',item.name));
        const target=cardTarget(item),hint=item.refId?(target?.name||'مقصد حذف شده؛ ویرایش کنید'):({types:'همهٔ انواع تجهیز',models:'همهٔ مدل‌ها',regions:'همهٔ مناطق',siteKinds:'همهٔ انواع محل',buildings:'همهٔ ساختمان‌ها',datacenters:'همهٔ دیتا سنترها'})[item.facet];
        go.title=item.name+' — '+hint;
        go.append(title,el('span','eq-muted',hint));
        const edit=button('ویرایش',()=>editCard(item),'eq-mini-action'),remove=button('حذف',()=>deleteCard(item),'eq-mini-action eq-danger');
        edit.setAttribute('aria-label','ویرایش کارت '+item.name);remove.setAttribute('aria-label','حذف کارت '+item.name);edit.disabled=remove.disabled=!!cardsIssue;
        card.append(go,tools(edit,remove));cards.append(card);
      }
      if(!cardSettings.cards.length)cards.append(notice('کارتی ندارید؛ با «افزودن کارت» میان‌بُر دلخواه بسازید. دسته‌ها از تب‌های بالا همچنان در دسترس‌اند.'));
      main.append(cards);
    }else{
      const key=groupCatalogKey(),headingRow=el('div','eq-table-toolbar');
      const addCategory=button('＋ افزودن زیرمجموعه',()=>manageCatalog(key,null,groupPreset()));addCategory.disabled=!!storageIssue;
      headingRow.append(el('h4','',facets.find(f=>f[0]===facet)[1]),tools(addCategory,button('مدیریت این دسته‌ها',()=>manageCatalog(key))));main.append(headingRow);
      if(groupIssue)main.append(notice(groupIssue,'warning'));
      const grid=el('div','eq-card-grid eq-smart-groups eq-groups-'+facet);for(const {item,field,count}of groupItems()){
        const box=el('article','eq-card'+(filters[field]===item.id?' eq-group-selected':'')),go=button('',()=>applyFilter(field,item.id),'eq-card-main');
        const title=el('div','eq-group-title');title.append(el('strong','',item.name),el('span','eq-badge',count+' نود'));go.append(title);go.title=item.name;
        if(item.typeId)go.append(el('span','eq-muted',nameOf('types',item.typeId)));if(item.siteKindId)go.append(el('span','eq-muted',nameOf('siteKinds',item.siteKindId)));
        const add=button('＋ نود',()=>{applyFilter(field,item.id);editNode();},'eq-mini-action');add.setAttribute('aria-label','＋ نود در این دسته');
        const edit=button('ویرایش',()=>manageCatalog(key,item),'eq-mini-action');edit.setAttribute('aria-label','ویرایش دسته '+item.name);
        const remove=button('حذف',()=>removeGroup(key,item),'eq-mini-action eq-danger');remove.setAttribute('aria-label','حذف دسته '+item.name);
        add.disabled=edit.disabled=remove.disabled=!!storageIssue;
        box.append(go,tools(add,edit,remove));grid.append(box);
      }if(!groupItems().length)grid.append(notice('هنوز دسته‌ای تعریف نشده؛ از «افزودن زیرمجموعه» استفاده کنید.'));main.append(grid);
    }
    main.append(filtersBar());
    const context=el('div','eq-active-filters');for(const field of M.fields)if(filters[field])context.append(button(nameOf(lookup[field],filters[field])+' ×',()=>applyFilter(field,''),'eq-filter-chip'));
    if(Object.keys(filters).length||onlyReview)context.append(button('پاک‌کردن فیلترها',()=>{filters={};activeField=null;onlyReview=false;render();}));main.append(context);
    const panel=el('section','eq-inventory-panel'),bar=el('div','eq-table-toolbar');bar.append(el('h4','','فهرست نودها'));
    const input=el('input','inp');input.id='equipment-node-search';input.placeholder='جست‌وجوی نام یا IP…';input.setAttribute('aria-label','جست‌وجوی نود');input.value=search;
    const list=el('div');const draw=()=>{list.replaceChildren();table(inventory.nodes.filter(node=>M.matches(node,filters)&&(!onlyReview||M.incomplete(node))&&[node.name,node.host].some(v=>v.toLowerCase().includes(search.toLowerCase()))),list);};
    input.addEventListener('input',()=>{search=input.value;draw();});bar.append(input);panel.append(bar,list);main.append(panel);draw();
    main.append(el('p','eq-muted','حذف از یک دسته، خود نود را حذف نمی‌کند. دسته‌های هر نود از مشخصات آن ساخته می‌شوند؛ جابه‌جایی دستی یا کپی نود لازم نیست.'));
  }
  async function runCheck(){
    if(!credentials||!can()||!path.node||busy)return;
    const token=epoch;busy=true;result={state:'checking'};render();
    await new Promise(resolve=>setTimeout(resolve,450));
    if(token!==epoch||!credentials||!can())return;
    busy=false;result={state:scenario};checks.set(path.node,scenario);render();
  }
  function deviceView(main){
    const {node,type,model,region,siteKind,site}=selected();
    const title=el('div','eq-device-title');title.append(icon(type?.kind||'other'),heading(node.name,node.host+' · '+(type?.name||'نوع نامشخص')+' · '+(site?.name||'محل نامشخص')),el('span','eq-badge','DEVICE 360° · نمایشی'));main.append(title);
    const tabs=el('div','eq-tabs');tabs.setAttribute('role','tablist');
    for(const [key,label] of [['overview','نمای کلی'],['interfaces','پورت‌ها و خطاها'],['favorites','دستورهای موردعلاقه']]){const b=button(label,()=>{tab=key;render();},'eq-tab'+(tab===key?' active':''));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab===key));tabs.append(b);}main.append(tabs);
    const controls=tools();const label=el('label','eq-scenario','سناریوی نمایشی '),select=el('select','inp');select.id='equipment-demo-scenario';
    for(const [value,text] of [['clean','وضعیت پاک'],['errdisabled','پورت Err-disabled'],['still','باقی‌ماندن خطا پس از بازیابی'],['changed','نبود خطا در pre-check'],['auth','خطای RADIUS'],['timeout','پایان زمان اتصال'],['connection','خطای اتصال']]){const o=el('option','',text);o.value=value;select.append(o);}select.value=scenario;select.disabled=busy;
    select.addEventListener('change',()=>{scenario=select.value;result=null;render();});label.append(select);controls.append(label);
    const check=button('بررسی وضعیت پورت‌ها',runCheck,'btn btn-primary btn-sm');check.id='equipment-check-submit';check.disabled=busy;controls.append(check);main.append(controls);
    if(node.legacyPath)main.append(notice('مسیر قبلی: '+node.legacyPath+' · برای تعیین مدل و منطقه از ویرایش نود استفاده کنید.'));
    main.append(button('ویرایش مشخصات نود',()=>editNode(node)));
    if(tab==='favorites')main.append(notice('در مرحلهٔ بعد: دستورهای پرتکرارِ تأییدشده و موردعلاقه برای هر نوع تجهیز. در این نسخه command آزاد، ذخیرهٔ تنظیمات یا Enable اجرا نمی‌شود.'));
    else if(tab==='overview'){
      const info=el('div','eq-info-grid');for(const [label,value] of [['IP مدیریتی',node.host],['نوع / مدل',(type?.name||'تعیین نشده')+' / '+(model?.name||'تعیین نشده')],['منطقه',region?.name||'تعیین نشده'],['محل استقرار',(siteKind?.name||'تعیین نشده')+' / '+(site?.name||'تعیین نشده')],['روش احراز هویت','RADIUS · نشست موقت'],['مدل و نسخهٔ سیستم‌عامل','هنوز جمع‌آوری نشده'],['CPU / Memory / Uptime','نیازمند اتصال واقعی سرور']]){const box=el('div','eq-info');box.append(el('span','eq-muted',label),el('strong','',value));info.append(box);}main.append(info);
    }
    const status=el('div','eq-status');status.id='equipment-status';status.setAttribute('role','status');
    const texts={checking:'نمایشی — در حال بررسی '+node.name+'…',clean:'وضعیت پاک (نمایشی): هیچ پورت Err-disabled وجود ندارد. disabled، connected و notconnect خطا محسوب نمی‌شوند.',errdisabled:'نمایشی — یک پورت Err-disabled یافت شد: Gi0/1 · ATM 17',auth:'نمایشی — احراز هویت RADIUS پذیرفته نشد. این خطا به‌تنهایی ثابت نمی‌کند حساب تجهیز Local است.',timeout:'نمایشی — زمان اتصال به پایان رسید؛ هنوز هیچ اتصال واقعی انجام نشده است.',connection:'نمایشی — اتصال به تجهیز انجام نشد.',recovered:'نمایشی — پورت Gi0/1 پس از تأیید شما بازیابی شد؛ هیچ دستور واقعی اجرا نشد.',still_result:'نمایشی — پورت Gi0/1 پس از بازیابی همچنان Err-disabled است.',changed_result:'نمایشی — پورت Gi0/1 پیش از بازیابی دیگر Err-disabled نبود؛ تغییری اعمال نشد.'};
    status.textContent=result?(texts[result.state]||texts.errdisabled):'این نود هنوز در این بازدید بررسی نشده است. نتیجه‌ها فقط نمایشی‌اند.';
    if(result&&['errdisabled','still','changed','still_result','auth','timeout','connection'].includes(result.state))status.classList.add('error');
    if(result&&['clean','recovered','changed_result'].includes(result.state))status.classList.add('ok');main.append(status);
    if(result&&['errdisabled','still','changed'].includes(result.state))main.append(button('تأیید بازیابی Gi0/1',()=>{
      if(!credentials||!can())return;
      if(confirm('فقط بازیابی پورت Gi0/1 روی «'+node.name+'» ('+node.host+') شبیه‌سازی شود؟\nدر نسخهٔ واقعی، pre-check و post-check همان پورت الزامی است.')){result={state:result.state==='still'?'still_result':result.state==='changed'?'changed_result':'recovered'};checks.set(path.node,result.state);render();}
    },'btn btn-amber btn-sm'));
    if(result?.state==='auth')main.append(notice('ورود با حساب Local و رمز Enable: برنامه‌ریزی‌شده برای مرحلهٔ بعد؛ فعلاً غیرفعال است. هیچ تلاش خودکار یا تغییر روش ورود انجام نمی‌شود.','warning'));
    main.append(el('p','eq-muted','SNMP، مانیتورینگ پیوسته، توپولوژی و مدیریت تنظیمات هنوز متصل نشده‌اند؛ مقدار ساختگی به‌عنوان دادهٔ واقعی نمایش داده نمی‌شود.'));
  }
  function render(){
    configuration.suspend();root.replaceChildren();if(!can()){root.append(notice('برای ورود به مدیریت تجهیزات مجوز لازم است.'));return;}
    if(credentials&&credentials.userId!==Access.current()?.id){credentials=null;checks.clear();path={};configuration.clear();workspaceTab='inventory';}
    if(!credentials){gate();return;}
    const top=el('div','eq-session-bar');top.append(el('span','eq-session-dot'),el('strong','','RADIUS آماده است'),el('span','eq-muted','معتبر تا خروج از حساب FAM · فقط در حافظه'),button('تغییر اطلاعات RADIUS',lock));root.append(top);
    root.append(notice('پیش‌نمایش محلی · فقط نام، IP و مشخصات نودها ذخیره می‌شود؛ رمز ذخیره یا ارسال نمی‌شود.','eq-demo-note'));
    if(storageIssue)root.append(notice(storageIssue,'warning'));if(cardsIssue)root.append(notice(cardsIssue,'warning'));if(migrationNote)root.append(notice(migrationNote));
    const sections=el('nav','eq-tabs eq-workspace-tabs');sections.setAttribute('role','tablist');sections.setAttribute('aria-label','بخش‌های تجهیزات');
    for(const [key,label]of [['inventory','فهرست تجهیزات'],['configuration','پیکربندی']]){
      const tabButton=button(label,()=>{epoch++;busy=false;if(result?.state==='checking')result=null;workspaceTab=key;render();},'eq-tab'+(workspaceTab===key?' active':''));
      tabButton.id='equipment-tab-'+key;tabButton.setAttribute('role','tab');tabButton.setAttribute('aria-selected',String(workspaceTab===key));sections.append(tabButton);
    }root.append(sections);
    const layout=el('div','eq-layout'),main=el('div','eq-main');layout.append(main);root.append(layout);
    if(workspaceTab==='configuration')configuration.mount(main);else if(selected().node){main.append(button('← بازگشت به فهرست نودها',()=>navigate({})));deviceView(main);}else inventoryView(main);
  }
  // A RADIUS credential session belongs to the MAIN FAM login, not to a tab.
  // Navigation never writes credentials to persistent storage or destroys them.
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-view], [data-act="go-cp"], #account-logout');if(!target)return;
    if(target.id==='account-logout'){lock();return;}
    if(target.dataset.view==='equipment'){render();return;}
    if(credentials){configuration.suspend();epoch++;busy=false;if(result?.state==='checking')result=null;activeDialog?.close();activeDialog?.remove();activeDialog=null;}
  },true);
  new MutationObserver(()=>{
    if(credentials&&(document.documentElement.classList.contains('auth-pending')||!can()||credentials.userId!==Access.current()?.id))lock();
    else if(!credentials&&can()&&!root.querySelector('#equipment-radius-user'))render();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',lock); // Also clear before a page can enter BFCache.
  load();loadCards();render();
});
