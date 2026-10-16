/* LOCAL configuration planner / dry-run UI only. No network or command executor.
   Commands and results stay in this factory's closure RAM, never inventory storage. */
(()=>{
  'use strict';
  const M=FamEquipmentInventory;
  const lists={typeId:'types',modelId:'models',regionId:'regions',siteKindId:'siteKinds',siteId:'sites'};
  function normalizeRules(inventory,rules){
    if(!Array.isArray(rules)||!rules.length||rules.length>12)throw Error('بین ۱ تا ۱۲ گروه هدف انتخاب کنید.');
    return rules.map(rule=>{
      if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).some(key=>!M.fields.includes(key)))throw Error('شرط گروه هدف معتبر نیست.');
      const clean={};
      for(const field of M.fields){
        const id=rule[field];if(id===undefined||id===null||id==='')continue;
        if(typeof id!=='string'||!inventory.catalog[lists[field]].some(item=>item.id===id))throw Error('یکی از دسته‌های مقصد در دسترس نیست؛ دوباره انتخاب کنید.');
        clean[field]=id;
      }
      if(!Object.keys(clean).length)throw Error('برای هر گروه هدف حداقل یک شرط انتخاب کنید؛ انتخاب خالی به معنی همهٔ تجهیزات نیست.');
      if(clean.modelId&&clean.typeId&&inventory.catalog.models.find(item=>item.id===clean.modelId).typeId!==clean.typeId)throw Error('مدل و نوع تجهیزِ گروه هدف با هم سازگار نیستند.');
      if(clean.siteId&&clean.siteKindId&&inventory.catalog.sites.find(item=>item.id===clean.siteId).siteKindId!==clean.siteKindId)throw Error('محل و نوع محلِ گروه هدف با هم سازگار نیستند.');
      return clean;
    });
  }
  function buildPlan(value,rules){
    const inventory=M.validate(value),clean=normalizeRules(inventory,rules);
    const matched=inventory.nodes.filter(node=>clean.some(rule=>M.matches(node,rule)));
    const targets=matched.filter(node=>!M.incomplete(node));
    const hosts=new Map();for(const node of inventory.nodes)hosts.set(node.host,(hosts.get(node.host)||0)+1);
    if(targets.some(node=>hosts.get(node.host)>1))throw Error('یکی از مقصدها IP تکراری در موجودی دارد؛ ابتدا تعارض IP نودها را برطرف کنید.');
    return {targets,matchedCount:matched.length,incompleteCount:matched.length-targets.length,rules:clean,
      signature:JSON.stringify({inventory,rules:clean})};
  }
  function validateDraft(text){
    if(typeof text!=='string'||!text.trim())throw Error('متن دستورهای پیکربندی را وارد کنید.');
    if(text.length>12000)throw Error('متن پیکربندی حداکثر ۱۲۰۰۰ نویسه است.');
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(text))throw Error('کاراکتر کنترلی در متن دستورها مجاز نیست.');
    const lines=text.replace(/\r\n?/g,'\n').split('\n');
    if(lines.length>120||lines.some(line=>line.length>512))throw Error('حداکثر ۱۲۰ خط و ۵۱۲ نویسه در هر خط مجاز است.');
    return {lineCount:lines.filter(line=>line.trim()).length,charCount:text.length};
  }
  function create({getInventory,isAuthorized}){
    let draft='',rules=[{}],revision=0,outcome=null,dialog=null,container=null,page=0,plan=null;
    let ruleBox=null,targetBox=null,review=null,draftStatus=null;
    const PAGE_SIZE=25;
    const el=(tag,cls,text)=>{const item=document.createElement(tag);if(cls)item.className=cls;if(text!==undefined)item.textContent=text;return item;};
    const button=(text,handler,cls='btn btn-ghost btn-sm')=>{const item=el('button',cls,text);item.type='button';item.addEventListener('click',handler);return item;};
    const note=(text,warning=false)=>el('div','eq-notice'+(warning?' warning':''),text);
    const tools=(...items)=>{const row=el('div','eq-tools');row.append(...items);return row;};
    const find=(key,id)=>getInventory().catalog[key].find(item=>item.id===id);
    const label=(key,id)=>find(key,id)?.name||'تعیین نشده';
    function suspend(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
    function changed(){revision++;outcome=null;page=0;suspend();}
    function clear(){
      suspend();if(container)container.querySelectorAll('textarea').forEach(input=>{input.value='';});
      draft='';rules=[{}];revision++;outcome=null;plan=null;page=0;container=ruleBox=targetBox=review=draftStatus=null;
    }
    function useSelection(filters){changed();rules=[Object.fromEntries(M.fields.filter(field=>filters[field]).map(field=>[field,filters[field]]))];}
    function ready(){
      if(!review||!draftStatus)return;
      let valid=false;
      try{const info=validateDraft(draft);draftStatus.textContent=info.lineCount+' خط · '+info.charCount+' نویسه · فقط در حافظه';valid=true;}
      catch(e){draftStatus.textContent=draft.trim()?e.message:'متن دستورها هنوز وارد نشده است؛ اطلاعات واقعی یا رمز ننویسید.';}
      review.disabled=!valid||!plan?.targets.length||!isAuthorized();
    }
    function rows(){
      targetBox.replaceChildren();
      if(!plan){targetBox.append(note('گروه‌های مقصد را کامل کنید تا نودهای هدف نمایش داده شوند.'));return;}
      const count=plan.targets.length;
      const status=el('div','eq-config-summary');status.setAttribute('role','status');
      status.append(el('strong','',count+' نود یکتا در مقصد'),el('span','eq-muted',plan.incompleteCount+' نود نیازمند تکمیل کنار گذاشته شد · هر نود مشترک فقط یک‌بار'));
      targetBox.append(status);
      if(outcome)targetBox.append(note('شبیه‌سازی برای '+outcome.size+' نود تکمیل شد. هیچ اتصال یا ارسال دستور واقعی انجام نشد.'));
      if(!count){targetBox.append(note('هیچ نود کامل و قابل انتخابی با این شرط‌ها وجود ندارد.'));return;}
      page=Math.min(page,Math.ceil(count/PAGE_SIZE)-1);
      const wrap=el('div','eq-table-wrap'),table=el('table','eq-table');table.setAttribute('aria-label','نودهای مقصد پیکربندی');
      const head=el('thead'),tr=el('tr');for(const title of ['نام و IP','نوع / مدل','منطقه / محل','وضعیت نمایشی'])tr.append(el('th','',title));head.append(tr);table.append(head);
      const body=el('tbody');
      for(const node of plan.targets.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
        const row=el('tr'),name=el('td'),type=el('td'),site=el('td');
        name.append(el('strong','',node.name),el('span','eq-node-sub eq-mono',node.host));
        type.append(el('span','',label('types',node.typeId)),el('span','eq-node-sub',label('models',node.modelId)));
        site.append(el('span','',label('regions',node.regionId)),el('span','eq-node-sub',label('sites',node.siteId)));
        row.append(name,type,site,el('td','',outcome?.has(node.id)?'شبیه‌سازی شد · بدون ارسال':'آمادهٔ بازبینی · بدون ارسال'));body.append(row);
      }
      table.append(body);wrap.append(table);targetBox.append(wrap);
      if(count>PAGE_SIZE){
        const previous=button('قبلی',()=>{page--;rows();}),next=button('بعدی',()=>{page++;rows();});previous.disabled=page===0;next.disabled=(page+1)*PAGE_SIZE>=count;
        targetBox.append(tools(previous,el('span','eq-muted','نمایش '+(page*PAGE_SIZE+1)+' تا '+Math.min((page+1)*PAGE_SIZE,count)+' از '+count+' مقصد'),next));
      }
    }
    function refresh(){
      try{plan=buildPlan(getInventory(),rules);rows();}
      catch(e){plan=null;targetBox.replaceChildren(note(e.message,true));}
      ready();
    }
    function drawRules(){
      ruleBox.replaceChildren();
      rules.forEach((rule,index)=>{
        if(index)ruleBox.append(el('div','eq-config-or','یا — اجتماع گروه‌ها، بدون نود تکراری'));
        const card=el('section','eq-config-rule'),top=el('div','eq-config-rule-top');top.append(el('strong','','گروه هدف '+(index+1)+' · شرط‌ها با «و»'));
        const remove=button('حذف گروه',()=>{changed();rules.splice(index,1);if(!rules.length)rules=[{}];drawRules();refresh();},'eq-mini-action eq-danger');remove.setAttribute('aria-label','حذف گروه هدف '+(index+1));top.append(remove);card.append(top);
        const grid=el('div','eq-config-rule-fields');
        for(const [field,title]of [['typeId','نوع تجهیز'],['modelId','مدل تجهیز'],['regionId','منطقه'],['siteKindId','نوع محل'],['siteId','محل استقرار']]){
          const wrap=el('label','eq-field',title),select=el('select','inp'),id='eq-config-rule-'+index+'-'+field;select.id=id;
          const all=el('option','','همه');all.value='';select.append(all);
          const items=getInventory().catalog[lists[field]].filter(item=>field==='modelId'?!rule.typeId||item.typeId===rule.typeId:field==='siteId'?!rule.siteKindId||item.siteKindId===rule.siteKindId:true);
          for(const item of items){const option=el('option','',item.name+(field==='modelId'?' · '+label('types',item.typeId):''));option.value=item.id;select.append(option);}
          if(rule[field]&&!items.some(item=>item.id===rule[field])){const stale=el('option','','دسته در دسترس نیست؛ دوباره انتخاب کنید');stale.value=rule[field];select.append(stale);}
          select.value=rule[field]||'';
          select.addEventListener('change',()=>{
            changed();if(select.value)rule[field]=select.value;else delete rule[field];
            if(field==='typeId'&&rule.modelId&&find('models',rule.modelId)?.typeId!==select.value)delete rule.modelId;
            if(field==='modelId'&&select.value)rule.typeId=find('models',select.value).typeId;
            if(field==='siteKindId'&&rule.siteId&&find('sites',rule.siteId)?.siteKindId!==select.value)delete rule.siteId;
            if(field==='siteId'&&select.value)rule.siteKindId=find('sites',select.value).siteKindId;
            drawRules();refresh();ruleBox.querySelector('#'+id)?.focus({preventScroll:true});
          });wrap.append(select);grid.append(wrap);
        }
        card.append(grid);ruleBox.append(card);
      });
      const add=button('＋ افزودن گروه هدف (یا)',()=>{changed();rules.push({});drawRules();refresh();});add.id='eq-config-add-rule';add.disabled=rules.length>=12;ruleBox.append(add);
    }
    function confirmPreview(){
      if(!isAuthorized())return;
      let live,info;try{live=buildPlan(getInventory(),rules);info=validateDraft(draft);if(!live.targets.length)return;}catch(e){refresh();return;}
      suspend();const snapshot={revision,signature:live.signature,text:draft};
      dialog=el('dialog','eq-dialog eq-dialog-wide');dialog.id='eq-config-confirm';dialog.setAttribute('aria-labelledby','eq-config-confirm-title');
      const close=()=>suspend();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      const title=el('h3','','بازبینی دیپلوی نمایشی');title.id='eq-config-confirm-title';
      dialog.append(title,note('فقط شبیه‌سازی: '+info.lineCount+' خط دستور برای '+live.targets.length+' نود یکتا. هیچ SSH، API یا فرمان واقعی اجرا نمی‌شود.',true));
      const list=el('div','eq-config-review-list');
      for(const node of live.targets)list.append(el('div','',node.name+' · '+node.host));dialog.append(list);
      const label=el('label','eq-config-ack'),ack=el('input');ack.type='checkbox';ack.id='eq-config-ack';label.append(ack,el('span','','نودهای مقصد را بازبینی کردم؛ فقط شبیه‌سازی بدون ارسال دستور انجام شود.'));
      const error=el('div','eq-error');error.setAttribute('role','alert');
      const submit=button('تأیید و شبیه‌سازی دیپلوی',()=>{
        if(!ack.checked||!isAuthorized())return;
        try{
          const current=buildPlan(getInventory(),rules);validateDraft(draft);
          if(snapshot.revision!==revision||snapshot.signature!==current.signature||snapshot.text!==draft)throw Error('متن یا نودهای مقصد تغییر کرده‌اند؛ این پنجره را ببندید و دوباره بازبینی کنید.');
          // Intentionally no executor: record ONLY a RAM-only dry-run marker.
          outcome=new Set(current.targets.map(node=>node.id));plan=current;close();rows();ready();
        }catch(e){error.textContent=e.message;submit.disabled=true;ack.disabled=true;}
      },'btn btn-primary');submit.id='eq-config-confirm-submit';submit.disabled=true;ack.addEventListener('change',()=>{submit.disabled=!ack.checked||!isAuthorized();});
      dialog.append(label,error,tools(submit,button('انصراف',close)));document.body.append(dialog);dialog.showModal();ack.focus();
    }
    function mount(main){
      suspend();container=el('section','eq-config-workspace');main.append(container);
      const head=el('div','eq-config-heading');head.append(el('div','eq-eyebrow','CONFIGURATION · OFFLINE DRY RUN'),el('h3','','پیکربندی گروهی'),el('p','eq-muted','دستورها را بنویسید، دسته‌های مقصد را انتخاب و قبل از دیپلوی، نودهای هدف را بازبینی کنید.'));container.append(head);
      container.append(note('نسخهٔ لوکال: فقط شبیه‌سازی دیپلوی؛ هیچ دستور واقعی ارسال نمی‌شود. متن فقط در حافظه می‌ماند. رمز و پیکربندی حساس واقعی وارد نکنید. اعتبارسنجی نحوی Cisco انجام نمی‌شود.',true));
      const layout=el('div','eq-config-layout'),editor=el('article','eq-config-card'),targets=el('article','eq-config-card');
      editor.append(el('h4','','۱. متن پیکربندی'));
      const label=el('label','eq-field','دستورهای کانفیگ'),text=el('textarea','inp eq-config-commands');text.id='eq-config-commands';text.dir='ltr';text.rows=11;text.maxLength=12000;text.autocomplete='off';text.spellcheck=false;text.value=draft;text.placeholder='! مثال ساختگی — فقط پیش‌نمایش\ninterface GigabitEthernet0/1\n description DEMO-ONLY';
      text.addEventListener('input',()=>{changed();draft=text.value;rows();ready();});label.append(text);editor.append(label);
      draftStatus=el('p','eq-muted');draftStatus.id='eq-config-draft-status';
      editor.append(draftStatus,button('پاک‌کردن متن',()=>{changed();draft='';text.value='';rows();ready();text.focus();}));
      targets.append(el('h4','','۲. انتخاب دسته‌های مقصد'),el('p','eq-muted','در هر گروه، شرط‌ها با «و» ترکیب می‌شوند؛ بین گروه‌ها «یا» است. مثلاً روتر + منطقه ۲، یا مدل 1841، یا سوئیچ + مدل 2960. انتخاب خالی مجاز نیست.'));
      ruleBox=el('div','eq-config-rules');targets.append(ruleBox);layout.append(editor,targets);container.append(layout);
      const preview=el('section','eq-config-card eq-config-preview');preview.append(el('h4','','۳. نودهای مقصد و دیپلوی نمایشی'));targetBox=el('div');targetBox.id='eq-config-targets';preview.append(targetBox);
      review=button('بازبینی و دیپلوی نمایشی',confirmPreview,'btn btn-primary');review.id='eq-config-review';preview.append(tools(review));container.append(preview);drawRules();refresh();
    }
    return Object.freeze({mount,suspend,clear,useSelection});
  }
  globalThis.FamEquipmentConfiguration=Object.freeze({normalizeRules,buildPlan,validateDraft,create});
})();
