/* FAM Equipment workspace — LOCAL UI ONLY. No API, SSH, polling or real device credentials.
   Only the validated inventory (names/IPs/groups) is persisted. RADIUS stays in closure RAM. */
document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('equipment-workspace');if(!root)return;
  const KEY='fam.equipment.inventory.v2';
  let inventory=null,storageIssue='',credentials=null,path={},activeDialog=null,epoch=0;
  let scenario='clean',result=null,tab='overview',search='',busy=false;
  const checks=new Map();
  const uid=()=>crypto.randomUUID();
  const can=()=>typeof Access!=='undefined'&&Access.can('equipment');
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const button=(text,handler,cls='btn btn-ghost btn-sm')=>{const node=el('button',cls,text);node.type='button';node.addEventListener('click',handler);return node;};
  const group=(name,names)=>({id:uid(),name,nodes:[],sections:names.map(name=>({id:uid(),name,nodes:[]}))});
  const defaults=()=>['روتر','سوئیچ'].map((name,i)=>({id:uid(),name,kind:i?'switch':'router',categories:[
    group('شعبه و حوزه',['شعبه','حوزه','انبار و غیره']),
    group('ساختمان‌ها',['ساختمان مرکزی رضوان','ساختمان 68 شرقی فام','ساختمان 68 شرقی ملل','ساختمان 68 شرقی شرکت ها','ساختمان مرکزی فام','ساختمان ملاصدرا فام']),
    group('دیتا سنتر',['تهران','سمنان'])
  ]}));
  const privateIP=value=>{
    if(!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))return false;
    const p=value.split('.').map(Number);return p.every(n=>n<=255)&&(p[0]===10||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168);
  };
  const validName=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80&&!/[\x00-\x1f\x7f]/.test(value);
  function validate(value){
    const ids=new Set();let count=0;
    const identity=obj=>{
      if(!obj||typeof obj.id!=='string'||!/^[\w-]{1,64}$/.test(obj.id)||ids.has(obj.id)||!validName(obj.name)||++count>6000)throw Error('ساختار فهرست تجهیزات معتبر نیست.');
      ids.add(obj.id);return {id:obj.id,name:obj.name.trim()};
    };
    const nodes=items=>{if(!Array.isArray(items)||items.length>2000)throw Error('تعداد نودها معتبر نیست.');return items.map(n=>{const base=identity(n);if(typeof n.host!=='string'||!privateIP(n.host))throw Error('IP ثبت‌شده معتبر نیست.');return {...base,host:n.host};});};
    if(!value||value.version!==2||!Array.isArray(value.types)||value.types.length>30)throw Error('فهرست تجهیزات قابل خواندن نیست.');
    return {version:2,types:value.types.map(t=>{
      const base=identity(t);if(!['router','switch','other'].includes(t.kind)||!Array.isArray(t.categories)||t.categories.length>100)throw Error('نوع تجهیز معتبر نیست.');
      return {...base,kind:t.kind,categories:t.categories.map(c=>{
        const base=identity(c);if(!Array.isArray(c.sections)||c.sections.length>100)throw Error('دسته‌بندی معتبر نیست.');
        return {...base,nodes:nodes(c.nodes),sections:c.sections.map(s=>({...identity(s),nodes:nodes(s.nodes)}))};
      })};
    })};
  }
  function load(){
    try{const raw=localStorage.getItem(KEY);inventory=raw?validate(JSON.parse(raw)):{version:2,types:defaults()};}
    catch(e){inventory={version:2,types:[]};storageIssue='فهرست محلی قابل خواندن نیست؛ برای جلوگیری از از‌دست‌رفتن داده، بازنویسی غیرفعال است. اطلاعات مرورگر را پاک نکنید.';}
  }
  function save(next){
    if(!can())throw Error('مجوز مدیریت تجهیزات لازم است.');
    if(storageIssue)throw Error(storageIssue);
    const clean=validate(next);localStorage.setItem(KEY,JSON.stringify(clean));inventory=clean;
  }
  const selected=()=>{
    const type=inventory.types.find(t=>t.id===path.type);
    const category=type?.categories.find(c=>c.id===path.category);
    const section=category?.sections.find(s=>s.id===path.section);
    return {type,category,section,node:(section||category)?.nodes.find(n=>n.id===path.node)};
  };
  function entries(type=null){
    const rows=[];for(const t of type?[type]:inventory.types)for(const c of t.categories){
      for(const n of c.nodes)rows.push({type:t,category:c,section:null,node:n});
      for(const s of c.sections)for(const n of s.nodes)rows.push({type:t,category:c,section:s,node:n});
    }return rows;
  }
  const navigate=next=>{epoch++;path=next;search='';result=null;tab='overview';busy=false;render();};
  function lock(){
    epoch++;credentials=null;path={};result=null;busy=false;search='';checks.clear();
    activeDialog?.close();activeDialog?.remove();activeDialog=null;
    root.querySelectorAll('input[type=password]').forEach(n=>{n.value='';});render();
  }
  function notice(text,cls=''){return el('div','eq-notice '+cls,text);}
  function metric(value,label){const card=el('div','eq-metric');card.append(el('strong','',String(value)),el('span','',label));return card;}
  function heading(title,sub){const box=el('div','eq-heading');box.append(el('h3','',title),el('p','',sub));return box;}
  function tools(...buttons){const box=el('div','eq-tools');box.append(...buttons);return box;}
  function icon(kind){const box=el('div','eq-device-icon');box.setAttribute('aria-hidden','true');box.textContent=kind==='router'?'⇄':kind==='switch'?'▤':'◇';return box;}
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
      credentials={username:user.value.trim(),password:password.value};password.value='';user.value='';path={};render();
    });
    card.append(form,notice('پیش‌نمایش محلی: فقط اطلاعات ساختگی وارد کنید. این مرحله احراز هویت واقعی RADIUS نیست. رمز ذخیره یا ارسال نمی‌شود.','warning'),el('p','eq-muted','پیش‌فرض: RADIUS · مسیر حساب Local و Enable در مرحلهٔ بعد طراحی می‌شود و فعلاً اجرا نمی‌شود.'));
    root.append(card);
  }
  function edit(kind,target=null){
    if(!can()||storageIssue)return;
    const {type,category,section}=selected();
    const titles={type:'نوع تجهیز',category:'دسته',section:'زیر‌بخش',node:'نود'};
    const dialog=el('dialog','eq-dialog');activeDialog=dialog;
    const form=el('form','eq-editor');form.autocomplete='off';
    const close=()=>{dialog.close();dialog.remove();activeDialog=null;};
    form.append(heading((target?'ویرایش ':'افزودن ')+titles[kind],kind==='node'?'فقط نام و IP خصوصی تجهیز ثبت می‌شود؛ نه اطلاعات ورود.':'نام‌ها و گروه‌بندی‌ها قابل تغییرند.'));
    const field=(id,label,value,type='text')=>{const wrap=el('label','eq-field',label),input=el('input','inp');input.id=id;input.value=value||'';input.type=type;input.required=true;input.maxLength=id==='eq-edit-host'?15:80;wrap.append(input);form.append(wrap);return input;};
    const name=field('eq-edit-name','نام',target?.name);
    let host=null,kindSelect=null;
    if(kind==='node'){host=field('eq-edit-host','IP تجهیز',target?.host);host.dir='ltr';host.placeholder='10.2.35.2';}
    if(kind==='type'){
      const label=el('label','eq-field','الگوی نمایش'),select=el('select','inp');select.id='eq-edit-kind';
      for(const [value,text] of [['router','روتر'],['switch','سوئیچ'],['other','سایر تجهیزات']]){const option=el('option','',text);option.value=value;select.append(option);}select.value=target?.kind||'other';kindSelect=select;label.append(select);form.append(label);
    }
    const error=el('div','eq-error');error.setAttribute('role','alert');form.append(error);
    const submit=el('button','btn btn-primary','ذخیره');submit.type='submit';form.append(tools(submit,button('انصراف',close)));
    form.addEventListener('submit',event=>{
      event.preventDefault();try{
        if(!credentials||!can())throw Error('دوباره وارد بخش تجهیزات شوید.');
        const label=name.value.trim();if(!validName(label))throw Error('نام معتبر (حداکثر ۸۰ نویسه) وارد کنید.');
        if(host&&!privateIP(host.value.trim()))throw Error('فقط IPv4 خصوصی معتبر: 10.x، 172.16 تا 172.31 یا 192.168.x');
        if(host&&entries(type).some(row=>row.node.host===host.value.trim()&&row.node.id!==target?.id))throw Error('این IP در همین نوع تجهیز ثبت شده است.');
        const next=structuredClone(inventory),t=next.types.find(t=>t.id===type?.id),c=t?.categories.find(c=>c.id===category?.id),s=c?.sections.find(s=>s.id===section?.id);
        const list=kind==='type'?next.types:kind==='category'?t.categories:kind==='section'?c.sections:(s||c).nodes;
        if(list.some(item=>item.name===label&&item.id!==target?.id))throw Error('این نام در همین گروه وجود دارد.');
        if(target){const item=list.find(item=>item.id===target.id);if(!item)throw Error('آیتم دیگر وجود ندارد.');item.name=label;if(host)item.host=host.value.trim();if(kindSelect)item.kind=kindSelect.value;}
        else list.push(kind==='type'?{id:uid(),name:label,kind:kindSelect.value,categories:[]}:kind==='category'?{id:uid(),name:label,nodes:[],sections:[]}:kind==='section'?{id:uid(),name:label,nodes:[]}:{id:uid(),name:label,host:host.value.trim()});
        save(next);close();result=null;render();
      }catch(e){error.textContent=e.name==='QuotaExceededError'?'فضای ذخیرهٔ مرورگر کافی نیست؛ هیچ تغییری ثبت نشد.':e.message;}
    });
    dialog.append(form);document.body.append(dialog);dialog.showModal();name.focus();
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  }
  function remove(kind,item){
    if(!can()||storageIssue)return;
    if(!confirm('«'+item.name+'» حذف شود؟'+(kind==='node'?'':' همهٔ زیر‌بخش‌ها و نودهای داخل آن نیز حذف می‌شوند.')+'\nاین کار فقط فهرست محلی را تغییر می‌دهد، نه تجهیز واقعی را.'))return;
    try{
      const {type,category,section}=selected(),next=structuredClone(inventory),t=next.types.find(t=>t.id===type?.id),c=t?.categories.find(c=>c.id===category?.id),s=c?.sections.find(s=>s.id===section?.id);
      const owner=kind==='type'?next:kind==='category'?t:kind==='section'?c:(s||c),key=kind==='type'?'types':kind==='category'?'categories':kind==='section'?'sections':'nodes';
      owner[key]=owner[key].filter(n=>n.id!==item.id);save(next);
      if(kind==='type'&&path.type===item.id)path={};if(kind==='category'&&path.category===item.id)path={type:path.type};if(kind==='section'&&path.section===item.id)path={type:path.type,category:path.category};if(kind==='node')delete path.node;
      result=null;render();
    }catch(e){alert('تغییر ثبت نشد: '+e.message);}
  }
  function card(item,subtitle,handler,kind,style='other'){
    const box=el('article','eq-card');const go=button('',handler,'eq-card-main');go.append(icon(style),el('strong','',item.name),el('span','eq-muted',subtitle));
    box.append(go,tools(button('ویرایش',()=>edit(kind,item)),button('حذف',()=>remove(kind,item),'btn btn-ghost btn-sm eq-danger')));return box;
  }
  function tree(){
    const aside=el('aside','eq-tree');aside.setAttribute('aria-label','گروه‌های تجهیزات');aside.append(el('div','eq-eyebrow','DEVICE GROUPS'),el('h4','','گروه‌های تجهیزات'),button('همهٔ تجهیزات',()=>navigate({}),'eq-tree-link'+(!path.type?' selected':'')));
    for(const t of inventory.types){
      aside.append(button(t.name+' · '+entries(t).length,()=>navigate({type:t.id}),'eq-tree-link'+(path.type===t.id&&!path.category?' selected':'')));
      if(t.id!==path.type)continue;
      for(const c of t.categories){
        aside.append(button(c.name,()=>navigate({type:t.id,category:c.id}),'eq-tree-link depth-1'+(path.category===c.id&&!path.section?' selected':'')));
        if(c.id===path.category)for(const s of c.sections)aside.append(button(s.name,()=>navigate({type:t.id,category:c.id,section:s.id}),'eq-tree-link depth-2'+(path.section===s.id?' selected':'')));
      }
    }return aside;
  }
  function breadcrumbs(){
    const {type,category,section,node}=selected(),nav=el('nav','eq-breadcrumbs');nav.setAttribute('aria-label','مسیر تجهیزات');
    nav.append(button('تجهیزات',()=>navigate({})));
    for(const [item,p] of [[type,{type:type?.id}],[category,{type:type?.id,category:category?.id}],[section,{type:type?.id,category:category?.id,section:section?.id}]])if(item){nav.append(el('span','','/'),button(item.name,()=>navigate(p)));}
    if(node)nav.append(el('span','','/'),el('strong','',node.name));return nav;
  }
  function table(rows,container){
    const wrap=el('div','eq-table-wrap'),table=el('table','eq-table');table.setAttribute('aria-label','فهرست نودها');
    const head=el('thead'),hr=el('tr');for(const title of ['نام تجهیز','IP مدیریتی','محل استقرار','وضعیت','مدیریت'])hr.append(el('th','',title));head.append(hr);table.append(head);
    const body=el('tbody');
    for(const row of rows){
      const tr=el('tr'),name=el('td');const open=()=>{navigate({type:row.type.id,category:row.category.id,...(row.section?{section:row.section.id}:{}),node:row.node.id});runCheck();};
      name.append(button(row.node.name,open,'eq-node-link'));const ip=el('td','eq-mono',row.node.host),location=el('td','',row.category.name+(row.section?' / '+row.section.name:''));
      const state=el('td');const last=checks.get(row.node.id);state.append(el('span','eq-badge',last?({clean:'پاک · نمایشی',errdisabled:'Err-disabled · نمایشی',still:'Err-disabled · نمایشی',changed:'بدون خطا · نمایشی',auth:'خطای ورود · نمایشی',timeout:'Timeout · نمایشی',connection:'خطای اتصال · نمایشی',recovered:'بازیابی · نمایشی',still_result:'خطا پابرجاست · نمایشی',changed_result:'بدون تغییر · نمایشی'}[last]||'نمایشی'):'بررسی نشده'));
      const actions=el('td');actions.append(tools(button('ویرایش',()=>{navigate({type:row.type.id,category:row.category.id,...(row.section?{section:row.section.id}:{})});edit('node',row.node);}),button('حذف',()=>{navigate({type:row.type.id,category:row.category.id,...(row.section?{section:row.section.id}:{})});remove('node',row.node);},'btn btn-ghost btn-sm eq-danger')));
      tr.append(name,ip,location,state,actions);body.append(tr);
    }
    if(!rows.length){const row=el('tr'),cell=el('td','eq-empty','هنوز نودی ثبت نشده است. «افزودن نود» را بزنید و نام و IP را وارد کنید.');cell.colSpan=5;row.append(cell);body.append(row);}
    table.append(body);wrap.append(table);container.append(wrap);
  }
  function inventoryView(main){
    const {type,category,section}=selected();let rows=entries(type);
    if(category)rows=rows.filter(row=>row.category.id===category.id);if(section)rows=rows.filter(row=>row.section?.id===section.id);
    const title=section?.name||category?.name||type?.name||'مرکز مدیریت تجهیزات';
    main.append(heading(title,'دسته‌بندی مکان‌محور، فهرست نودها و نمای اختصاصی هر تجهیز'));
    const stats=el('div','eq-metrics');stats.append(metric(rows.length,'نود ثبت‌شده'),metric(type?type.categories.length:inventory.types.length,type?'دسته':'نوع تجهیز'),metric('RADIUS','روش ورود پیش‌فرض'),metric('محلی','حالت پیش‌نمایش'));main.append(stats);
    let list,kind,subtitle;
    if(!type){list=inventory.types;kind='type';subtitle=item=>entries(item).length+' نود · '+item.categories.length+' دسته';}
    else if(!category){list=type.categories;kind='category';subtitle=item=>item.sections.length+' زیر‌بخش';}
    else if(!section){list=category.sections;kind='section';subtitle=item=>item.nodes.length+' نود';}
    const actions=tools();
    if(kind)actions.append(button('＋ افزودن '+({type:'نوع تجهیز',category:'دسته',section:'زیر‌بخش'}[kind]),()=>edit(kind), 'btn btn-primary btn-sm'));
    if(category)actions.append(button('＋ افزودن نود',()=>edit('node'),'btn btn-primary btn-sm'));
    if(type)actions.append(button('ویرایش '+(section?'زیر‌بخش':category?'دسته':'نوع تجهیز'),()=>edit(section?'section':category?'category':'type',section||category||type)));
    main.append(actions);
    if(list){const grid=el('div','eq-card-grid');for(const item of list){
      const next=kind==='type'?{type:item.id}:kind==='category'?{type:type.id,category:item.id}:{type:type.id,category:category.id,section:item.id};
      grid.append(card(item,subtitle(item),()=>navigate(next),kind,kind==='type'?item.kind:'other'));
    }if(!list.length)grid.append(notice('این بخش خالی است؛ از دکمهٔ افزودن استفاده کنید.'));main.append(grid);}
    const bar=el('div','eq-table-toolbar');bar.append(el('h4','','فهرست نودها'));
    const filter=el('input','inp');filter.id='equipment-node-search';filter.placeholder='جست‌وجوی نام یا IP…';filter.setAttribute('aria-label','جست‌وجوی نود');filter.value=search;
    const tableHost=el('div');const draw=()=>{tableHost.replaceChildren();table(rows.filter(row=>[row.node.name,row.node.host,row.section?.name||''].some(value=>value.toLowerCase().includes(search.toLowerCase()))),tableHost);};
    filter.addEventListener('input',()=>{search=filter.value;draw();});bar.append(filter);main.append(bar,tableHost);draw();
    if(!category)main.append(el('p','eq-muted','برای افزودن نود، ابتدا نوع تجهیز و دسته یا زیر‌بخش موردنظر را انتخاب کنید.'));
  }
  async function runCheck(){
    if(!credentials||!can()||!path.node||busy)return;
    const token=epoch;busy=true;result={state:'checking'};render();
    await new Promise(resolve=>setTimeout(resolve,450));
    if(token!==epoch||!credentials||!can())return;
    busy=false;result={state:scenario};checks.set(path.node,scenario);render();
  }
  function deviceView(main){
    const {node,type,category,section}=selected();
    const title=el('div','eq-device-title');title.append(icon(type.kind),heading(node.name,node.host+' · '+type.name+' · '+(section?.name||category.name)),el('span','eq-badge','DEVICE 360° · نمایشی'));main.append(title);
    const tabs=el('div','eq-tabs');tabs.setAttribute('role','tablist');
    for(const [key,label] of [['overview','نمای کلی'],['interfaces','پورت‌ها و خطاها'],['favorites','دستورهای موردعلاقه']]){const b=button(label,()=>{tab=key;render();},'eq-tab'+(tab===key?' active':''));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab===key));tabs.append(b);}main.append(tabs);
    const controls=tools();const label=el('label','eq-scenario','سناریوی نمایشی '),select=el('select','inp');select.id='equipment-demo-scenario';
    for(const [value,text] of [['clean','وضعیت پاک'],['errdisabled','پورت Err-disabled'],['still','باقی‌ماندن خطا پس از بازیابی'],['changed','نبود خطا در pre-check'],['auth','خطای RADIUS'],['timeout','پایان زمان اتصال'],['connection','خطای اتصال']]){const o=el('option','',text);o.value=value;select.append(o);}select.value=scenario;select.disabled=busy;
    select.addEventListener('change',()=>{scenario=select.value;result=null;render();});label.append(select);controls.append(label);
    const check=button('بررسی وضعیت پورت‌ها',runCheck,'btn btn-primary btn-sm');check.id='equipment-check-submit';check.disabled=busy;controls.append(check);main.append(controls);
    if(tab==='favorites')main.append(notice('در مرحلهٔ بعد: دستورهای پرتکرارِ تأییدشده و موردعلاقه برای هر نوع تجهیز. در این نسخه command آزاد، ذخیرهٔ تنظیمات یا Enable اجرا نمی‌شود.'));
    else if(tab==='overview'){
      const info=el('div','eq-info-grid');for(const [label,value] of [['IP مدیریتی',node.host],['نوع تجهیز',type.name],['محل استقرار',category.name+' / '+(section?.name||'بدون زیر‌بخش')],['روش احراز هویت','RADIUS · نشست موقت'],['مدل و نسخهٔ سیستم‌عامل','هنوز جمع‌آوری نشده'],['CPU / Memory / Uptime','نیازمند اتصال واقعی سرور']]){const box=el('div','eq-info');box.append(el('span','eq-muted',label),el('strong','',value));info.append(box);}main.append(info);
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
    root.replaceChildren();if(!can()){root.append(notice('برای ورود به مدیریت تجهیزات مجوز لازم است.'));return;}
    if(!credentials){gate();return;}
    const top=el('div','eq-session-bar');top.append(el('span','eq-session-dot'),el('strong','','نشست موقت RADIUS'),el('span','eq-muted','فقط حافظه · بدون ذخیرهٔ رمز'),button('تغییر اطلاعات ورود / خروج',lock));root.append(top);
    root.append(notice('نسخهٔ محلی / نمایشی — فهرست نام و IP در همین مرورگر ذخیره می‌شود؛ هیچ اتصال SSH، RADIUS یا API برقرار نیست. رمز واقعی وارد نکنید.','warning'));
    if(storageIssue)root.append(notice(storageIssue,'warning'));
    const layout=el('div','eq-layout'),main=el('div','eq-main');layout.append(tree(),main);root.append(layout);main.append(breadcrumbs());
    if(selected().node)deviceView(main);else inventoryView(main);
  }
  // Any exit from the equipment workspace ends its transient credential session.
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-view], [data-act="go-cp"], #account-logout');
    if(!target)return;
    const view=target.dataset.view;
    if(view==='equipment'||credentials&&(view&&view!=='equipment'||target.dataset.act==='go-cp'||target.id==='account-logout'))lock();
  },true);
  new MutationObserver(()=>{if(credentials&&(document.documentElement.classList.contains('auth-pending')||!can()))lock();else if(!credentials)render();}).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  load();render();
});
