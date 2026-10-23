'use strict';
/* Legacy global name retained. Generic, scoped metadata tree; never device I/O. */
window.FamEquipmentSwitchPicker=(()=>{
 const normalize=v=>String(v??'').normalize('NFKC').replace(/[۰-۹]/g,n=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(n))).replace(/[٠-٩]/g,n=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(n))).replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim().toLowerCase();
 const isManual=n=>n.typeId===undefined&&n.id.startsWith('manual-');
 function tree(nodes,catalog,{empty=true}={}){
  const get=(key,id)=>catalog[key]?.find(x=>x.id===id),rank={router:0,switch:1,other:2};
  const leaf=n=>({key:'device/'+n.id,label:n.name,kind:'device',id:n.id,node:n,ids:[n.id]});
  const group=(key,label,kind,id,children)=>({key,label,kind,id,children,ids:[...new Set(children.flatMap(c=>c.ids))]});
  const place=(rows,base,sites=[])=>{
   const ids=[...new Set([...sites.map(s=>s.id),...rows.map(n=>n.siteId).filter(Boolean)])],children=[];
   for(const id of ids){const local=rows.filter(n=>n.siteId===id);if(!empty&&!local.length)continue;children.push(group(base+'/site/'+id,get('sites',id)?.name||'محل نامشخص','site',id,local.map(leaf)));}
   children.push(...rows.filter(n=>!n.siteId).map(leaf));return children;
  };
  const roots=[];
  const types=[...(catalog.types||[])].sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3));
  for(const type of types){
   const rows=nodes.filter(n=>n.typeId===type.id);if(!empty&&!rows.length)continue;
   const base='type/'+type.id,children=[];
   const special=n=>['building','datacenter'].includes(get('siteKinds',n.siteKindId)?.kind);
   const regional=rows.filter(n=>!special(n));
   for(const region of catalog.regions||[]){const local=regional.filter(n=>n.regionId===region.id);if(!empty&&!local.length)continue;
    const kinds=[...new Set(local.map(n=>n.siteKindId).filter(Boolean))];let items;
    if(kinds.length>1){items=kinds.map(id=>group(base+'/region/'+region.id+'/kind/'+id,get('siteKinds',id)?.name||'نوع محل نامشخص','siteKind',id,place(local.filter(n=>n.siteKindId===id),base+'/region/'+region.id+'/kind/'+id)));items.push(...local.filter(n=>!n.siteKindId).map(leaf));}
    else items=place(local,base+'/region/'+region.id);
    children.push(group(base+'/region/'+region.id,region.name,'region',region.id,items));
   }
   const noRegion=regional.filter(n=>!get('regions',n.regionId));if(noRegion.length)children.push(group(base+'/no-region','بدون منطقه','region','',place(noRegion,base+'/no-region')));
   for(const kind of catalog.siteKinds||[]){if(!['building','datacenter'].includes(kind.kind))continue;const local=rows.filter(n=>n.siteKindId===kind.id);if(!empty&&!local.length)continue;
    const sites=empty?(catalog.sites||[]).filter(s=>s.siteKindId===kind.id):[];
    const label=kind.kind==='building'&&kind.name==='ساختمان اداره'?'ساختمان‌های اداری':kind.name;
    children.push(group(base+'/kind/'+kind.id,label,'siteKind',kind.id,place(local,base+'/kind/'+kind.id,sites)));
   }
   roots.push({...group(base,type.name||({router:'روتر',switch:'سوئیچ'}[type.kind]||'سایر تجهیزات'),'type',type.id,children),deviceKind:type.kind});
  }
  const manual=nodes.filter(isManual);if(manual.length)roots.push(group('manual','IPهای دستی','manual','manual',manual.map(leaf)));
  // Incomplete metadata remains visible, never silently omitted or inferred.
  const known=new Set(roots.flatMap(r=>r.ids)),other=nodes.filter(n=>!known.has(n.id));if(other.length)roots.push(group('uncategorized','دسته‌بندی تکمیل‌نشده','other','other',other.map(leaf)));
  return roots;
 }
 function mount(parent,{nodes,catalog,selected,busy,max=4000,onSelect,onSelectMany,onManual,onError}){
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const all=()=>{const list=typeof nodes==='function'?nodes():nodes;return list.filter(n=>!isManual(n)||selected.has(n.id));};
  const readCatalog=()=>typeof catalog==='function'?catalog():catalog;let catalogSnapshot={};
  const categories=()=>catalogSnapshot;
  const category=(key,id)=>categories()[key]?.find(v=>v.id===id);
  const ancestry=n=>[category('types',n.typeId)?.name,category('regions',n.regionId)?.name,category('siteKinds',n.siteKindId)?.name,category('sites',n.siteId)?.name].filter(Boolean);
  const field=el('div','eq-device-picker'),label=el('label','eq-review-search-label','IP یا نام محل'),search=el('input','inp');search.id='eq-live-search';label.htmlFor=search.id;search.placeholder='IP یا نام محل';search.maxLength=120;search.autocomplete='off';search.disabled=busy;search.setAttribute('role','combobox');search.setAttribute('aria-haspopup','dialog');search.setAttribute('aria-autocomplete','list');search.setAttribute('aria-controls','eq-live-picker-dropdown');search.setAttribute('aria-expanded','false');
  const inputWrap=el('div','eq-review-searchbox'),icon=el('span','eq-review-search-icon','⌕');icon.setAttribute('aria-hidden','true');inputWrap.append(icon,search);
  const dropdown=el('div','eq-device-dropdown');dropdown.id='eq-live-picker-dropdown';dropdown.hidden=true;dropdown.setAttribute('role','dialog');dropdown.setAttribute('aria-label','انتخاب تجهیزات از درخت دسته‌بندی');const expanded=new Set(),collapsedSearch=new Set(),pages=new Map();let lastQuery='';
  const close=()=>{dropdown.hidden=true;search.setAttribute('aria-expanded','false');};
  function selectMany(rows,value){if(busy)return;try{
   const unique=[...new Map(rows.map(n=>[n.id,n])).values()];if(value&&new Set([...selected,...unique.map(n=>n.id)]).size>max)throw Error('تعداد انتخاب‌ها بیش از ظرفیت موجودی است.');
   if(onSelectMany)onSelectMany(unique,value);else for(const n of unique)onSelect(n,value);refresh();
  }catch(e){onError(e.message);refresh();}}
  function check(item,parent,level){
   const node=item.node,li=el('li','eq-device-leaf');li.setAttribute('role','treeitem');li.setAttribute('aria-level',String(level));li.setAttribute('aria-checked',String(selected.has(node.id)));
   const row=el('label','eq-device-option'),input=el('input');input.type='checkbox';input.id='eq-live-node-'+node.id;input.checked=selected.has(node.id);input.disabled=busy;input.onchange=()=>selectMany([node],input.checked);
   const copy=el('span','eq-device-option-copy'),title=el('strong','',node.name),sub=el('small','',ancestry(node).join(' / ')),ip=el('span','eq-device-option-ip',node.host);ip.dir='ltr';copy.append(title,sub);row.append(input,copy,ip);li.append(row);parent.append(li);
  }
  function manual(value){if(busy)return;try{onManual(value);search.value='';close();}catch(e){onError(e.message);}}
  function draw(){
   catalogSnapshot=readCatalog();dropdown.replaceChildren();const raw=normalize(search.value),available=all(),top=el('div','eq-device-results-head'),exit=el('button','eq-picker-close','بستن');exit.type='button';exit.onclick=()=>{close();search.focus();close();};
   const tokens=raw.split(' ').filter(Boolean),matches=available.filter(n=>tokens.every(token=>normalize([n.name,n.host,...ancestry(n),category('models',n.modelId)?.name].join(' ')).includes(token)));
   top.append(el('span','',raw?matches.length.toLocaleString('fa-IR')+' تجهیز منطبق':available.length.toLocaleString('fa-IR')+' تجهیز در دسته‌بندی‌ها'),exit);dropdown.append(top);
   dropdown.append(el('p','eq-tree-help',raw?'تیک مجموعه، همهٔ اعضای منطبق با جست‌وجو در همان مجموعه را به لیست اضافه می‌کند.':'تیک هر مجموعه، تمام تجهیزات مجاز زیرمجموعهٔ آن را به لیست اضافه می‌کند.'));
   const treeRoot=el('ul','eq-device-tree');treeRoot.setAttribute('role','tree');treeRoot.setAttribute('aria-label','درخت تجهیزات');treeRoot.setAttribute('aria-multiselectable','true');dropdown.append(treeRoot);
   const roots=tree(matches,categories(),{empty:!raw}),byId=new Map(matches.map(n=>[n.id,n]));
   function render(items,parent,level){
    for(const item of items){if(item.node){check(item,parent,level);continue;}
     const li=el('li','eq-device-tree-group'),row=el('div','eq-tree-row');li.setAttribute('role','treeitem');li.setAttribute('aria-level',String(level));row.dataset.category=item.kind;row.dataset.groupId=item.id;if(item.deviceKind)row.dataset.deviceKind=item.deviceKind;
     const open=raw?!collapsedSearch.has(item.key):expanded.has(item.key),hasChildren=item.children.length>0;
     const chosen=item.ids.filter(id=>selected.has(id)).length,state=chosen===0?'false':chosen===item.ids.length?'true':'mixed';li.setAttribute('aria-checked',state);if(hasChildren)li.setAttribute('aria-expanded',String(open));
     const input=el('input','eq-tree-check');input.type='checkbox';input.id='eq-tree-check-'+encodeURIComponent(item.key);input.checked=!!item.ids.length&&chosen===item.ids.length;input.indeterminate=chosen>0&&chosen<item.ids.length;input.disabled=busy||!item.ids.length;input.setAttribute('aria-label','انتخاب مجموعهٔ '+item.label);input.onchange=()=>selectMany(item.ids.map(id=>byId.get(id)),input.checked);
     const toggle=el('button','eq-tree-toggle',hasChildren?(open?'▾':'◂'):'·'),title=el('button','eq-tree-title',item.label),folder=el('span','eq-tree-folder',item.kind==='type'?(item.deviceKind==='router'?'◇':'▤'):'▱'),count=el('span','eq-tree-count',chosen?chosen.toLocaleString('fa-IR')+' / '+item.ids.length.toLocaleString('fa-IR'):item.ids.length.toLocaleString('fa-IR'));
     folder.setAttribute('aria-hidden','true');toggle.type=title.type='button';toggle.disabled=title.disabled=busy||!hasChildren;toggle.tabIndex=-1;toggle.setAttribute('aria-label',(open?'بستن ':'بازکردن ')+item.label);title.setAttribute('aria-label',(open?'بستن ':'بازکردن ')+item.label);
     const expand=()=>{if(raw){open?collapsedSearch.add(item.key):collapsedSearch.delete(item.key);}else{open?expanded.delete(item.key):expanded.add(item.key);}draw();dropdown.querySelector('#'+CSS.escape(input.id))?.focus({preventScroll:true});};toggle.onclick=title.onclick=expand;
     row.onkeydown=e=>{if(hasChildren&&((e.key==='ArrowLeft'&&!open)||(e.key==='ArrowRight'&&open))){e.preventDefault();expand();}};
     row.append(toggle,input,folder,title,count);li.append(row);parent.append(li);
     if(hasChildren&&open){const children=el('ul','eq-tree-children');children.setAttribute('role','group');li.append(children);const limit=pages.get(item.key)||50;let leaves=0,skipped=0;const showing=[];
      for(const child of item.children){if(child.node&&++leaves>limit)skipped++;else showing.push(child);}render(showing,children,level+1);
      if(skipped){const moreLi=el('li'),more=el('button','btn btn-ghost btn-sm eq-picker-more','نمایش تجهیزات بیشتر ('+skipped.toLocaleString('fa-IR')+')');more.type='button';if(!dropdown.querySelector('#eq-picker-more'))more.id='eq-picker-more';more.onclick=()=>{pages.set(item.key,limit+50);draw();};moreLi.setAttribute('role','none');moreLi.append(more);children.append(moreLi);}
     }
    }
   }
   render(roots,treeRoot,1);
   if(!matches.length)dropdown.append(el('p','eq-device-no-results','تجهیزی در این محدوده پیدا نشد.'));
   if(window.FamEquipmentInventory?.privateIP(raw)&&!available.some(n=>n.host===raw)){const add=el('button','btn btn-ghost btn-sm','＋ افزودن IP دستی '+raw);add.type='button';add.id='eq-live-add-ip';add.onclick=()=>manual(raw);dropdown.append(add);}
  }
  function refresh(){const focus=document.activeElement?.id,scroll=dropdown.scrollTop;if(!dropdown.hidden){draw();dropdown.scrollTop=scroll;if(focus?.startsWith('eq-live-node-')||focus?.startsWith('eq-tree-check-'))(document.getElementById(focus)||search).focus({preventScroll:true});}}
  const open=()=>{if(busy)return;dropdown.hidden=false;search.setAttribute('aria-expanded','true');draw();};search.onclick=open;search.onfocus=open;search.oninput=()=>{const query=normalize(search.value);if(query!==lastQuery){pages.clear();collapsedSearch.clear();lastQuery=query;}open();};
  search.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='ArrowDown'){e.preventDefault();open();dropdown.querySelector('input:not(:disabled)')?.focus();}else if(e.key==='Enter'){e.preventDefault();const value=normalize(search.value);if(/^\d{1,3}(\.\d{1,3}){3}$/.test(value))manual(value);else open();}};
  field.onkeydown=e=>{if(e.defaultPrevented)return;if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&e.target!==search){const inputs=[...dropdown.querySelectorAll('input[type=checkbox]:not(:disabled)')],index=inputs.indexOf(e.target);if(index>=0){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?inputs.length-1:index+(e.key==='ArrowDown'?1:-1);inputs[Math.max(0,Math.min(inputs.length-1,next))]?.focus();}}if(e.key==='ArrowRight'&&e.target.matches('input[type=checkbox]')){const ancestor=e.target.closest('li[role=treeitem]')?.parentElement.closest('li[role=treeitem]')?.querySelector(':scope > .eq-tree-row input');if(ancestor){e.preventDefault();ancestor.focus();}}if(e.key==='Escape'){close();search.focus();close();}if(e.key==='Tab')setTimeout(()=>{if(!field.contains(document.activeElement))close();},0);};
  field.append(label,inputWrap,dropdown);parent.append(field);return Object.freeze({refresh,close});
 }
 return Object.freeze({mount,tree,normalize});
})();
document.addEventListener('click',e=>{const picker=document.querySelector('#eq-live-picker-dropdown')?.parentElement;if(picker&&!e.composedPath().includes(picker)){picker.querySelector('#eq-live-picker-dropdown').hidden=true;picker.querySelector('#eq-live-search').setAttribute('aria-expanded','false');}});
