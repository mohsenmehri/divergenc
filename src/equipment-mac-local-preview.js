/* LOCAL design preview: no SSH, credentials, device result or configuration.
   Inventory entries are real local metadata; temporary selections remain RAM-only.
   MAC conflict cleanup and grouped execution below are PROPOSED SERVER behavior. */
window.FamLocalPortPreview=(()=>{
 'use strict';const choices=new Map();let manual=[],serial=0;const MAX=5;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const normalize=value=>value.replace(/[۰-۹٠-٩]/g,c=>String(c.charCodeAt(0)-(c>='۰'&&c<='۹'?1776:1632))).replace(/،/g,',');
 function ports(value){
  if(typeof value!=='string')throw Error('شمارهٔ پورت معتبر نیست.');const text=normalize(value).trim();if(!text)return [];
  if(!/^\d{1,2}(?:\s*,\s*\d{1,2})*$/.test(text)||text.split(',').length>24)throw Error('پورت‌ها را با ویرگول جدا کنید؛ مثلاً 6,10. بازهٔ 6-10 یا دستور CLI وارد نکنید.');
  const values=[...new Set(text.split(',').map(Number))].sort((a,b)=>a-b);
  if(values.some(p=>p<1||p>24))throw Error('شمارهٔ پورت باید بین ۱ تا ۲۴ باشد.');return values;
 }
 function portCommands(values){
  if(values.length===1)return ['interface FastEthernet0/'+values[0]];
  const spans=[];for(const value of values){const last=spans.at(-1);if(last&&value===last[1]+1)last[1]=value;else spans.push([value,value]);}
  // Classic 2960: at most five range clauses per command, comma surrounded by spaces.
  // Compress only adjacent EXPLICIT members; never fill an unselected gap.
  const clauses=spans.map(([a,b])=>'FastEthernet0/'+a+(a===b?'':' - '+b)),commands=[];
  for(let i=0;i<clauses.length;i+=5)commands.push('interface range '+clauses.slice(i,i+5).join(' , '));return commands;
 }
 function mount(parent,nodes,catalog={},nodeId){
  const root=el('section','eq-live-workspace eq-local-mac-v2');root.id='eq-local-mac-preview';root.append(el('h3','','انتخاب سوئیچ و پورت'),el('p','eq-notice warning','LOCAL — فقط پیش‌نمایش فرم و طرح مسیر عملیات؛ هیچ اتصال یا تغییری انجام نمی‌شود. رفع گروهی و پاک‌سازی MAC متعارض در SERVER فعلی هنوز اجرا نمی‌شوند. رمز تجهیز لازم نیست.'));
  const all=()=>[...nodes,...manual.filter(m=>!nodes.some(n=>n.host===m.host))];
  const state=node=>{if(!choices.has(node.id))choices.set(node.id,{selected:false,port:'',staticIp:false});return choices.get(node.id);};
  if(nodeId&&nodes.some(n=>n.id===nodeId))state(nodes.find(n=>n.id===nodeId)).selected=true;
  const count=()=>all().filter(n=>state(n).selected).length;
  const name=(key,id)=>catalog[key]?.find(v=>v.id===id)?.name||({'regions':'منطقه تعیین‌نشده','siteKinds':'نوع محل تعیین‌نشده','sites':'محل تعیین‌نشده'}[key]||'تعیین‌نشده');
  const output=el('section');output.id='eq-local-mac-output';output.setAttribute('aria-live','polite');
  const invalidate=()=>output.replaceChildren();const feedback=el('p','eq-error');feedback.id='eq-local-mac-feedback';feedback.setAttribute('aria-live','polite');
  const field=el('div','eq-local-switch-picker'),label=el('label','eq-field','IP یا نام سوئیچ — کلیک برای انتخاب از منطقه و ساختمان'),search=el('input','inp');search.id='eq-local-mac-search';search.placeholder='نام یا IP؛ مثلاً 100.100.1.22';search.setAttribute('role','combobox');search.setAttribute('aria-expanded','false');search.setAttribute('aria-controls','eq-local-mac-dropdown');search.autocomplete='off';search.maxLength=120;label.append(search);
  const dropdown=el('div','eq-local-switch-dropdown');dropdown.id='eq-local-mac-dropdown';dropdown.hidden=true;dropdown.setAttribute('role','group');dropdown.setAttribute('aria-label','انتخاب سوئیچ از منطقه و محل');
  const selected=el('div');selected.id='eq-local-mac-switches';const summary=el('p','eq-muted');summary.id='eq-local-mac-selection-count';
  let path={region:undefined,kind:undefined,site:undefined},active=-1;
  function close(){dropdown.hidden=true;search.setAttribute('aria-expanded','false');active=-1;}
  function open(){dropdown.hidden=false;search.setAttribute('aria-expanded','true');drawDropdown();}
  const toggle=(node,value)=>{feedback.textContent='';if(value&&!state(node).selected&&count()>=MAX){feedback.textContent='در هر نوبت حداکثر پنج سوئیچ انتخاب کنید.';return false;}state(node).selected=value;if(!value&&node.id.startsWith('local-preview-')){manual=manual.filter(n=>n.id!==node.id);choices.delete(node.id);}invalidate();drawSelected();return true;};
  function choose(node){const s=state(node),row=el('label','eq-local-switch-option'),tick=el('input');tick.type='checkbox';tick.checked=s.selected;tick.dataset.choice=node.id;tick.onchange=()=>{if(!toggle(node,tick.checked))tick.checked=false;};row.append(tick,el('span','',node.name+' · '+node.host));dropdown.append(row);}
  function addManual(value){
   feedback.textContent='';const existing=all().find(n=>n.host===value);if(existing){if(toggle(existing,true)){search.value='';close();}return;}
   if(!FamEquipmentInventory.privateIP(value)){feedback.textContent='یک IP داخلی مجاز وارد کنید یا سوئیچ را از فهرست انتخاب کنید.';return;}
   if(count()>=MAX){feedback.textContent='در هر نوبت حداکثر پنج سوئیچ انتخاب کنید.';return;}
   // Only selected manual identities are retained, bounded to five (no history).
   manual=manual.filter(n=>state(n).selected);
   let id;do{id='local-preview-'+(++serial);}while(all().some(n=>n.id===id));
   const node={id,name:'IP دستی',host:value};manual.push(node);toggle(node,true);search.value='';close();
  }
  function drawDropdown(){
   dropdown.replaceChildren();active=-1;
   const top=el('div','eq-local-picker-top');top.append(el('strong','',search.value.trim()?'نتایج جست‌وجو':'انتخاب از منطقه و ساختمان'));
   const exit=el('button','btn btn-ghost btn-sm','بستن');exit.type='button';exit.onclick=()=>{close();search.focus();};top.append(exit);dropdown.append(top);
   const query=search.value.trim().toLowerCase();
   if(query){
    const matches=all().filter(n=>[n.name,n.host,name('regions',n.regionId),name('sites',n.siteId)].join(' ').toLowerCase().includes(query));
    for(const n of matches.slice(0,50))choose(n);
    if(matches.length>50)dropdown.append(el('p','eq-muted','۵۰ نتیجهٔ اول؛ جست‌وجو را دقیق‌تر کنید.'));
    if(!matches.length)dropdown.append(el('p','eq-muted','سوئیچ منطبق در موجودی مجاز پیدا نشد.'));
    if(FamEquipmentInventory.privateIP(query)&&!all().some(n=>n.host===query)){
     const add=el('button','btn btn-ghost btn-sm','＋ انتخاب IP دستی '+query);add.type='button';add.id='eq-local-mac-add';add.onclick=()=>addManual(query);dropdown.append(add);
    }
    return;
   }
   const crumbs=el('div','eq-local-picker-crumbs');const crumb=(text,fn)=>{const b=el('button','btn btn-ghost btn-sm',text);b.type='button';b.onclick=()=>{fn();drawDropdown();};crumbs.append(b);};
   crumb('همهٔ مناطق',()=>{path={region:undefined,kind:undefined,site:undefined};});
   if(path.region!==undefined)crumb(name('regions',path.region),()=>{path.kind=undefined;path.site=undefined;});
   if(path.kind!==undefined)crumb(name('siteKinds',path.kind),()=>{path.site=undefined;});
   if(path.site!==undefined)crumb(name('sites',path.site),()=>{});
   dropdown.append(crumbs);
   let candidates=nodes;
   for(const [part,property,key] of [['region','regionId','regions'],['kind','siteKindId','siteKinds'],['site','siteId','sites']]){
    if(path[part]===undefined){
     const groups=[...new Set(candidates.map(n=>n[property]||''))];
     for(const id of groups){const button=el('button','eq-local-picker-branch',name(key,id)+'  ‹');button.type='button';button.dataset.level=part;button.dataset.group=id;button.onclick=()=>{path[part]=id;drawDropdown();};dropdown.append(button);}
     if(!groups.length)dropdown.append(el('p','eq-muted','سوئیچی در موجودی مجاز ثبت نشده است؛ IP را در همین کادر وارد کنید.'));
     return;
    }
    candidates=candidates.filter(n=>(n[property]||'')===path[part]);
   }
   for(const node of candidates.slice(0,50))choose(node);
   if(candidates.length>50)dropdown.append(el('p','eq-muted','۵۰ سوئیچ اول؛ برای موارد دیگر از جست‌وجوی نام/IP استفاده کنید.'));
  }
  function drawSelected(){
   selected.replaceChildren();const picked=all().filter(n=>state(n).selected);summary.textContent=picked.length+' از ۵ سوئیچ انتخاب شده';
   if(!picked.length){selected.append(el('p','eq-muted','فقط سوئیچ‌هایی که انتخاب می‌کنید اینجا نمایش داده می‌شوند.'));return;}
   for(const node of picked){const s=state(node),row=el('div','eq-live-switch-row'),identity=el('div');identity.append(el('strong','',node.name),el('p','eq-mono',node.host));
    const portLabel=el('label','eq-field','پورت اختیاری؛ مثلاً 6,10'),port=el('input','inp');port.dataset.port=node.id;port.dir='ltr';port.maxLength=72;port.placeholder='خالی = انتخاب خطاها پس از بررسی';port.value=s.port;port.setAttribute('aria-label','پورت '+node.name);portLabel.append(port);
    const staticLabel=el('label','eq-tool-checkbox'),tick=el('input');tick.type='checkbox';tick.dataset.static=node.id;tick.checked=s.staticIp;tick.disabled=!s.port.trim();tick.onchange=()=>{s.staticIp=tick.checked;invalidate();};staticLabel.append(tick,el('span','','IP دستی — همان IP هر پورت، فقط MAC جدید'));
    port.oninput=()=>{s.port=port.value;tick.disabled=!s.port.trim();if(tick.disabled){s.staticIp=false;tick.checked=false;}invalidate();};
    const remove=el('button','btn btn-ghost btn-sm','حذف از انتخاب');remove.type='button';remove.dataset.remove=node.id;remove.onclick=()=>{toggle(node,false);if(node.id.startsWith('local-preview-')){manual=manual.filter(n=>n.id!==node.id);choices.delete(node.id);}if(!dropdown.hidden)drawDropdown();};
    row.append(identity,portLabel,staticLabel,remove);selected.append(row);
   }
  }
  search.addEventListener('click',open);search.oninput=()=>{feedback.textContent='';open();};
  search.onkeydown=e=>{
   if(e.key==='Escape'){e.preventDefault();close();return;}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(dropdown.hidden)open();const items=[...dropdown.querySelectorAll('button,input[type=checkbox]')];if(items.length){active=(active+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[active].focus();}return;}
   if(e.key==='Enter'){e.preventDefault();const query=normalize(search.value.trim());if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(query)){addManual(query);return;}
    const exact=all().filter(n=>n.name.toLowerCase()===query.toLowerCase());if(exact.length===1){if(toggle(exact[0],true)){search.value='';close();}}else{open();feedback.textContent='سوئیچ موردنظر را از نتایج تیک بزنید؛ نام مبهم خودکار انتخاب نمی‌شود.';}
   }
  };
  dropdown.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();search.focus();}});
  field.addEventListener('keydown',e=>{if(e.key==='Tab')setTimeout(()=>{if(!field.contains(document.activeElement))close();},0);});
  field.append(label,dropdown);drawSelected();
  const help=el('details','eq-cli-card');help.id='eq-local-diagnosis-help';help.append(el('summary','','بخش ۳ «تشخیص فقط‌خواندنی جابه‌جایی کلاینت» برای چیست؟'),el('p','','وقتی شمارهٔ پورت را نمی‌دانید، در SERVER با IP یا MAC کلاینت می‌توان شواهد MAC table، source binding و لاگ DAI را خواند و پورت احتمالی را پیدا کرد. هیچ MAC، binding یا ACL را تغییر نمی‌دهد و رفع خطا انجام نمی‌دهد. شواهد ممکن است قدیمی/ناقص باشند و تشخیص قطعی تضمین نمی‌شود. اگر کارشناس پورت را اعلام کرده، به این بخش نیازی ندارید. LOCAL حتی این خواندن را هم انجام نمی‌دهد.'));
  const review=el('button','btn btn-primary btn-sm','نمایش مسیر انتخاب‌شده — بدون اجرا');review.type='button';review.id='eq-local-mac-review';review.onclick=()=>{
   invalidate();feedback.textContent='';const picked=all().filter(n=>state(n).selected);if(!picked.length){feedback.textContent='یک تا پنج سوئیچ انتخاب کنید.';return;}
   let plans;try{plans=picked.map(n=>({node:n,s:state(n),ports:ports(state(n).port)}));}catch(e){feedback.textContent=e.message;return;}
   for(const plan of plans){const {node,s,ports:values}=plan,card=el('article','eq-tool-card');card.append(el('h4','',node.name+' · '+node.host));
    if(!values.length)card.append(el('p','','پورت خالی: در طرح SERVER، ابتدا Err-disabledهای همین سوئیچ خوانده می‌شوند؛ کارشناس پورت‌های خطادار را انتخاب و تأیید می‌کند. پورت‌های تأییدشدهٔ همین سوئیچ به‌صورت گروهی و فقط با همان اعضا در interface range قرار می‌گیرند؛ نه تک‌تک و نه همهٔ پورت‌ها. LOCAL خطاها را نمی‌خواند و پورتی حدس زده نمی‌شود.'));
    else{
     card.append(el('p','','پورت‌های انتخاب‌شده: '+values.map(n=>'Fa0/'+n).join('، ')),el('p','',s.staticIp?'IP دستی: IP هر پورت از binding همان پورت خوانده می‌شود؛ IPها بدون تغییر می‌مانند و فقط MAC مربوط به هر IP عوض می‌شود.':'بدون تیک دستی: binding ثابت و ARP ACL بازنویسی نمی‌شوند.'));
     const steps=el('ol');for(const text of ['پیش‌بررسی همهٔ اعضا و تأیید پورت‌ها و مجازبودن دستگاه جابه‌جاشده','بستن پورت‌های هدف و برداشتن موقت IPSG',...(s.staticIp?['حذف محدود binding و permit قدیمی هر کلاینت از Inspection؛ IP هر پورت جداگانه حفظ می‌شود']:[]),'برای هر پورت، خواندن شواهد MAC متعارض و جست‌وجوی دقیق همان MAC روی پورت دیگر همان سوئیچ','اگر رکورد روی پورت قبلی تأیید شد: نمایش MAC و پورت قبلی/جدید و گرفتن تأیید جابه‌جایی؛ سپس حذف فقط همان رکورد متناسب با نوع Sticky/Configured/Dynamic؛ نه clear کلی','پس از رفع تعارض، shutdown / no shutdown گروهی فقط روی پورت‌های تأییدشدهٔ همین سوئیچ؛ بررسی جداگانهٔ نتیجهٔ هر عضو',...(s.staticIp?['ساخت binding و permit جدید Inspection برای هر MAC جدید با همان IP قبلی']:[]),'بازگرداندن IPSG و بررسی نتیجهٔ هر پورت؛ در ابهام یا خطا ادامه ندادن'])steps.append(el('li','',text));card.append(steps);
     const title=el('p','eq-muted',values.length>1?'نمونهٔ گروه فرمان پورت — فقط اعضای انتخاب‌شده، نه سناریوی کامل قابل اجرا:':'نمونهٔ فرمان همان پورت — نه سناریوی کامل قابل اجرا:');const pre=el('pre','eq-live-command-output','configure terminal\n'+portCommands(values).map(command=>command+'\nshutdown\nno shutdown\nexit').join('\n')+'\nend');pre.dir='ltr';card.append(title,pre);
     if(values.length>1)card.append(el('p','eq-notice','مثال: برای 6,10 فقط Fa0/6 و Fa0/10 انتخاب می‌شوند؛ پورت‌های ۷، ۸ و ۹ عضو نیستند. فرمان range برای پورت‌هاست؛ binding و ARP ACL هر IP همچنان مستقل مدیریت می‌شوند.'));
    }
    card.append(el('p','eq-notice warning','این طرحِ رفتار درخواستی است، نه قابلیت اجراشدهٔ SERVER فعلی. مشاهدهٔ تاریخی یا MAC روی uplink مجوز حذف نیست؛ نوع رکورد و پورت قبلی باید قابل تأیید باشند. در نبود شواهد روشن، حذف انجام نمی‌شود. اینجا هیچ فرمان یا اتصال واقعی اجرا نشده است.'));output.append(card);
   }
  };
  root.append(field,feedback,summary,selected,review,output,help);parent.append(root);
 }
 document.addEventListener('click',e=>{const picker=document.querySelector('#eq-local-mac-preview .eq-local-switch-picker');if(picker&&!e.composedPath().includes(picker)){picker.querySelector('#eq-local-mac-dropdown').hidden=true;picker.querySelector('#eq-local-mac-search').setAttribute('aria-expanded','false');}});
 document.addEventListener('fam-access-changed',()=>{choices.clear();manual=[];});window.addEventListener('pagehide',()=>{choices.clear();manual=[];});
 return Object.freeze({mount,ports});
})();
