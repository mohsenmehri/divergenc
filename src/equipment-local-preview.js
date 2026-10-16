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
    const tone=kind==='type'?style:kind==='section'?'location':item.name.includes('ساختمان')?'building':item.name.includes('سنتر')?'datacenter':'branch';
    const box=el('article','eq-card eq-card-'+kind+' tone-'+tone);
    const go=button('',handler,'eq-card-main');
    const top=el('span','eq-card-top');top.append(icon(kind==='section'?'branch':tone),el('span','eq-card-label',kind==='type'?'DEVICE FAMILY':kind==='category'?'LOCATION GROUP':'LOCATION'));
    const copy=el('span','eq-card-copy');copy.append(el('strong','',item.name),el('span','eq-muted',subtitle));
    go.append(top,copy);
    if(kind==='category'){
      const chips=el('span','eq-card-chips');for(const section of item.sections.slice(0,3))chips.append(el('span','',section.name));
      if(item.sections.length>3)chips.append(el('span','',String(item.sections.length-3)+'+'));go.append(chips);
    }
    const footer=el('span','eq-card-footer');footer.append(el('span','',kind==='type'?'مشاهده و مدیریت تجهیزات':kind==='category'?'ورود به این گروه':'مشاهده نودها'),el('span','eq-card-arrow','↗'));go.append(footer);
    const editButton=button('ویرایش',()=>edit(kind,item),'eq-mini-action');editButton.setAttribute('aria-label','ویرایش '+item.name);
    const removeButton=button('حذف',()=>remove(kind,item),'eq-mini-action eq-danger');removeButton.setAttribute('aria-label','حذف '+item.name);
    box.append(go,tools(editButton,removeButton));return box;
  }
  function tree(){
    const nav=el('nav','eq-type-nav');nav.setAttribute('aria-label','نوع تجهیزات');
    nav.append(button('همهٔ تجهیزات',()=>navigate({}),'eq-tree-link'+(!path.type?' selected':'')));
    for(const type of inventory.types){const b=button('',()=>navigate({type:type.id}),'eq-tree-link'+(path.type===type.id?' selected':''));b.append(icon(type.kind),el('span','',type.name),el('span','eq-nav-count',String(entries(type).length)));nav.append(b);}return nav;
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
    const title=section?.name||category?.name||type?.name||'شبکهٔ شما، یک نمای یکپارچه';
    const hero=el('div','eq-hero');
    const intro=el('div','eq-hero-copy');intro.append(el('div','eq-eyebrow',section?'NODE INVENTORY':category?'EXPLORE LOCATIONS':type?'EXPLORE YOUR NETWORK':'NETWORK OPERATIONS'),heading(title,section?'برای بازکردن نمای مدیریت، روی نام نود کلیک کنید.':category?'محل موردنظر را انتخاب کنید یا یک زیر‌بخش جدید بسازید.':type?'تجهیزات را بر اساس محل استقرارشان پیدا و مدیریت کنید.':'از انتخاب نوع تجهیز تا مدیریت تک‌تک نودهای شبکه.'));
    const stats=el('div','eq-metrics');stats.append(metric(rows.length,'نود ثبت‌شده'),metric(type?type.categories.length:inventory.types.length,type?'گروه مکانی':'نوع تجهیز'));hero.append(intro,stats);main.append(hero);
    let list,kind,subtitle;
    if(!type){list=inventory.types;kind='type';subtitle=item=>entries(item).length+' نود · '+item.categories.length+' دسته';}
    else if(!category){list=type.categories;kind='category';subtitle=item=>item.sections.length+' زیر‌بخش';}
    else if(!section){list=category.sections;kind='section';subtitle=item=>item.nodes.length+' نود';}
    const actions=tools();actions.classList.add('eq-group-actions');
    if(kind)actions.append(button('＋ افزودن '+({type:'نوع تجهیز',category:'دسته',section:'زیر‌بخش'}[kind]),()=>edit(kind), 'btn btn-primary btn-sm'));
    if(type)actions.append(button('ویرایش '+(section?'زیر‌بخش':category?'دسته':'نوع تجهیز'),()=>edit(section?'section':category?'category':'type',section||category||type)));
    main.append(actions);
    if(list){const grid=el('div','eq-card-grid eq-grid-'+kind);for(const item of list){
      const next=kind==='type'?{type:item.id}:kind==='category'?{type:type.id,category:item.id}:{type:type.id,category:category.id,section:item.id};
      grid.append(card(item,subtitle(item),()=>navigate(next),kind,kind==='type'?item.kind:'other'));
    }if(!list.length)grid.append(notice('این بخش خالی است؛ از دکمهٔ افزودن استفاده کنید.'));main.append(grid);}
    const panel=el('section','eq-inventory-panel');
    const bar=el('div','eq-table-toolbar');const titleBox=el('div');titleBox.append(el('h4','','فهرست نودها'),el('span','eq-muted','موجودی تجهیزات در محدودهٔ انتخاب‌شده'));bar.append(titleBox);
    const filter=el('input','inp');filter.id='equipment-node-search';filter.placeholder='جست‌وجوی نام یا IP…';filter.setAttribute('aria-label','جست‌وجوی نود');filter.value=search;
    const tableHost=el('div');const draw=()=>{tableHost.replaceChildren();table(rows.filter(row=>[row.node.name,row.node.host,row.section?.name||''].some(value=>value.toLowerCase().includes(search.toLowerCase()))),tableHost);};
    filter.addEventListener('input',()=>{search=filter.value;draw();});const controls=tools(filter);if(category)controls.append(button('＋ افزودن نود',()=>edit('node'),'btn btn-primary btn-sm'));bar.append(controls);panel.append(bar,tableHost);main.append(panel);draw();
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
    if(credentials&&credentials.userId!==Access.current()?.id){credentials=null;checks.clear();path={};}
    if(!credentials){gate();return;}
    const top=el('div','eq-session-bar');top.append(el('span','eq-session-dot'),el('strong','','RADIUS آماده است'),el('span','eq-muted','معتبر تا خروج از حساب FAM · فقط در حافظه'),button('تغییر اطلاعات RADIUS',lock));root.append(top);
    root.append(notice('پیش‌نمایش محلی · بدون اتصال واقعی به تجهیزات. فقط اطلاعات ساختگی وارد کنید.','eq-demo-note'));
    if(storageIssue)root.append(notice(storageIssue,'warning'));
    const layout=el('div','eq-layout'),main=el('div','eq-main');root.append(tree());layout.append(main);root.append(layout);main.append(breadcrumbs());
    if(selected().node)deviceView(main);else inventoryView(main);
  }
  // A RADIUS credential session belongs to the MAIN FAM login, not to a tab.
  // Navigation never writes credentials to persistent storage or destroys them.
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-view], [data-act="go-cp"], #account-logout');if(!target)return;
    if(target.id==='account-logout'){lock();return;}
    if(target.dataset.view==='equipment'){render();return;}
    if(credentials){epoch++;busy=false;if(result?.state==='checking')result=null;activeDialog?.close();activeDialog?.remove();activeDialog=null;}
  },true);
  new MutationObserver(()=>{
    if(credentials&&(document.documentElement.classList.contains('auth-pending')||!can()||credentials.userId!==Access.current()?.id))lock();
    else if(!credentials&&can()&&!root.querySelector('#equipment-radius-user'))render();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',lock); // Also clear before a page can enter BFCache.
  load();render();
});
