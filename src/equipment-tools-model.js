/* Pure LOCAL equipment import / checklist / switch simulation. No I/O. */
(()=>{
 'use strict';const M=FamEquipmentInventory;
 const columns=['نام تجهیز','IP','نوع تجهیز','الگوی نوع','مدل تجهیز','منطقه','نوع محل','الگوی محل','محل استقرار','شناسه تجهیز'];
 const uid=()=>crypto.randomUUID(),idOK=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id);
 function inventoryRows(value){const d=M.validate(value),find=(key,id)=>d.catalog[key].find(x=>x.id===id);return [columns.slice(),...d.nodes.map(n=>[n.name,n.host,find('types',n.typeId)?.name||'',find('types',n.typeId)?.kind||'',find('models',n.modelId)?.name||'',find('regions',n.regionId)?.name||'',find('siteKinds',n.siteKindId)?.name||'',find('siteKinds',n.siteKindId)?.kind||'',find('sites',n.siteId)?.name||'',n.id])];}
 function catalogSnapshot(value){
  const d=M.validate(value),rows=[['FAM-CATALOG',1,'','',''],['بخش','شناسه','نام','الگو','والد']];
  for(const key of ['types','models','regions','siteKinds','sites'])for(const item of [...d.catalog[key]].sort((a,b)=>a.id.localeCompare(b.id)))rows.push([key,item.id,item.name,item.kind||'',item.typeId||item.siteKindId||'']);
  return rows;
 }
 function assertCatalogSnapshot(value,snapshot){
  if(!Array.isArray(snapshot))throw Error('این فایل فرم پویای تجهیزات نیست؛ ابتدا فرم به‌روز را از همین برنامه دریافت کنید.');
  if(JSON.stringify(snapshot)!==JSON.stringify(catalogSnapshot(value)))throw Error('دسته‌بندی‌ها پس از دریافت فایل تغییر کرده‌اند یا قالب متعلق به این موجودی نیست؛ فرم به‌روز بگیرید و ردیف‌های تجهیزات را به آن منتقل کنید.');
 }
 function prepareImport(value,rows,{update=false}={}){
  const base=M.validate(value),next=structuredClone(base),errors=[],counts={added:0,updated:0,categories:0};
  if(!Array.isArray(rows)||rows.length<2||rows.length>4001||!Array.isArray(rows[0])||rows[0].length<9||rows[0].length>10||rows[0].some((x,i)=>String(x).trim()!==columns[i]))throw Error('سرستون‌ها یا تعداد ردیف‌ها معتبر نیست؛ از قالب تجهیزات استفاده کنید (حداکثر ۴۰۰۰ ردیف).');
  const seenIPs=new Set(),seenIDs=new Set(),targetIDs=new Set(),byId=new Map(next.nodes.map(n=>[n.id,n]));
  const byIP=new Map();for(const n of next.nodes){const list=byIP.get(n.host)||[];list.push(n);byIP.set(n.host,list);}
  const define=(key,name,extra={})=>{let item=next.catalog[key].find(x=>x.name===name&&Object.entries(extra).every(([k,v])=>x[k]===v));if(item)return item;
   throw Error('دستهٔ تعریف‌نشده وجود دارد؛ فقط دسته‌های مجاز فعلی قابل ورودند. ابتدا دسته را در برنامه بسازید و فرم تازه بگیرید.');};
  for(let i=1;i<rows.length;i++){
   const row=rows[i];if(!Array.isArray(row)){errors.push({row:i+1,message:'ردیف معتبر نیست.'});continue;}if(row.every(x=>x===null||x===undefined||String(x).trim()===''))continue;
   try{
    if(row.length>10)throw Error('ستون اضافی مجاز نیست.');
    const r=Array.from({length:10},(_,j)=>row[j]===null||row[j]===undefined?'':String(row[j]).trim());
    for(const index of [0,2,4,5,6,8])if(!M.validName(r[index]))throw Error('نام تجهیز و همهٔ مشخصات دسته‌بندی باید معتبر و تکمیل باشند.');
    if(!M.privateIP(r[1]))throw Error('IPv4 خصوصی معتبر نیست.');
    if(!['router','switch','other'].includes(r[3])||!['branch','building','datacenter','other'].includes(r[7]))throw Error('الگوی نوع یا الگوی محل معتبر نیست.');
    if(seenIPs.has(r[1])||r[9]&&seenIDs.has(r[9]))throw Error('IP یا شناسه در خود فایل تکراری است.');seenIPs.add(r[1]);if(r[9])seenIDs.add(r[9]);
    const matches=byIP.get(r[1])||[],byID=r[9]?byId.get(r[9]):null;
    if(matches.length>1)throw Error('IP در موجودی قبلی مبهم و تکراری است.');
    if(byID&&matches.length&&matches[0].id!==byID.id||!byID&&r[9]&&matches.length&&matches[0].id!==r[9])throw Error('شناسه و IP به یک تجهیز اشاره نمی‌کنند.');
    const previous=byID||matches[0];if(previous&&targetIDs.has(previous.id))throw Error('یک تجهیز موجود در چند ردیف هدف گرفته شده است.');if(previous)targetIDs.add(previous.id);if(previous&&!update)throw Error('تجهیز موجود است؛ برای ویرایش، به‌روزرسانی صریح را فعال کنید.');
    if(r[9]&&!byID)throw Error('شناسه تجهیز در موجودی فعلی وجود ندارد؛ برای تجهیز جدید شناسه را خالی بگذارید.');
    if(r[9]&&!idOK(r[9]))throw Error('شناسه تجهیز معتبر نیست.');
    const namedType=next.catalog.types.find(x=>x.name===r[2]),namedKind=next.catalog.siteKinds.find(x=>x.name===r[6]);
    if(namedType&&namedType.kind!==r[3]||namedKind&&namedKind.kind!==r[7])throw Error('الگوی دسته با دستهٔ موجود سازگار نیست.');
    const type=define('types',r[2],{kind:r[3]}),model=define('models',r[4],{typeId:type.id}),region=define('regions',r[5]),kind=define('siteKinds',r[6],{kind:r[7]}),site=define('sites',r[8],{siteKindId:kind.id});
    const node={id:previous?.id||r[9]||uid(),name:r[0],host:r[1],typeId:type.id,modelId:model.id,regionId:region.id,siteKindId:kind.id,siteId:site.id,...(previous?.legacyPath?{legacyPath:previous.legacyPath}:{})};
    if(previous){const index=next.nodes.findIndex(n=>n.id===previous.id);next.nodes[index]=node;counts.updated++;}else{next.nodes.push(node);counts.added++;}
   }catch(e){errors.push({row:i+1,message:e.message});}
  }
  if(!counts.added&&!counts.updated&&!errors.length)errors.push({row:0,message:'فایل تجهیز قابل ثبت ندارد.'});
  let clean=null;if(!errors.length)try{clean=M.validate(next);const hosts=new Set();for(const n of clean.nodes){if(hosts.has(n.host)&&counts.updated)throw Error('پس از تغییر، IP تکراری ایجاد می‌شود.');hosts.add(n.host);}}catch(e){errors.push({row:0,message:e.message});clean=null;}
  return {next:errors.length?null:clean,errors,counts,base:JSON.stringify(base)};
 }
 const sensitive=text=>/\b(?:password|secret|community|key-string|token)\s+\S+|BEGIN[^\n]*PRIVATE KEY|(?:radius|tacacs)[^\n]*\bkey\s+\S+/i.test(text);
 function validateStandards(value){
  if(!value||value.version!==1||!Array.isArray(value.items)||value.items.length>100)throw Error('فهرست استانداردها معتبر نیست.');const ids=new Set();let total=0;
  return {version:1,items:value.items.map(s=>{
   if(!s||!idOK(s.id)||ids.has(s.id)||!M.validName(s.name)||!idOK(s.modelId)||s.siteKindId!==null&&!idOK(s.siteKindId)||s.siteId!==null&&!idOK(s.siteId)||!Array.isArray(s.checks)||!s.checks.length||s.checks.length>50)throw Error('مشخصات استاندارد معتبر نیست.');ids.add(s.id);
   const checks=s.checks.map(c=>{if(!c||!idOK(c.id)||ids.has(c.id)||!M.validName(c.name)||!['contains','not-contains','exact-line'].includes(c.operator)||typeof c.pattern!=='string'||!c.pattern.trim()||c.pattern.length>300||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(c.pattern)||++total>1000)throw Error('آیتم چک‌لیست معتبر نیست.');
    if(sensitive(c.pattern)||sensitive(c.name)||sensitive(s.name))throw Error('استاندارد نباید شامل رمز، کلید، توکن یا عبارت حساس باشد.');ids.add(c.id);return {id:c.id,name:c.name.trim(),operator:c.operator,pattern:c.pattern.trim()};});
   return {id:s.id,name:s.name.trim(),modelId:s.modelId,siteKindId:s.siteKindId,siteId:s.siteId,checks};
  })};
 }
 function applicable(node,standards){return validateStandards(standards).items.filter(s=>s.modelId===node.modelId&&(!s.siteKindId||s.siteKindId===node.siteKindId)&&(!s.siteId||s.siteId===node.siteId));}
 function audit(value,standards,nodeId,text){
  const inventory=M.validate(value),node=inventory.nodes.find(n=>n.id===nodeId);if(!node||M.incomplete(node))throw Error('یک تجهیز با مشخصات تکمیل‌شده انتخاب کنید.');
  if(typeof text!=='string'||text.length>12000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw Error('متن آزمایشی معتبر نیست (حداکثر ۱۲۰۰۰ نویسه).');
  const policies=applicable(node,standards),lines=text.split(/\r?\n/).map(l=>l.trim());
  const rows=policies.flatMap(s=>s.checks.map(c=>{let pass=c.operator==='contains'?text.includes(c.pattern):c.operator==='not-contains'?!text.includes(c.pattern):lines.includes(c.pattern);return {standard:s.name,check:c.name,status:!text.trim()?'unknown':pass?'ok':'fail'};}));
  return {node,rows,source:'متن آزمایشی کاربر — بدون اتصال',signature:JSON.stringify({node,standards:validateStandards(standards)})};
 }
 function switches(value,filters={}){const d=M.validate(value);return d.nodes.filter(n=>d.catalog.types.find(t=>t.id===n.typeId)?.kind==='switch'&&M.matches(n,filters));}
 function simulateErr(value,ids,scenarios){
  const d=M.validate(value);if(!Array.isArray(ids)||!ids.length||ids.length>4000||new Set(ids).size!==ids.length)throw Error('حداقل یک سوئیچ یکتا انتخاب کنید.');
  const allowed=new Map(switches(d).map(n=>[n.id,n]));
  return ids.map(id=>{const n=allowed.get(id);if(!n)throw Error('فقط سوئیچ‌های موجود قابل انتخاب‌اند.');if(d.nodes.filter(x=>x.host===n.host).length!==1)throw Error('IP مقصد تکراری و مبهم است.');
   const scenario=scenarios[id]||'unknown';if(!['unknown','clean','errdisabled','auth','timeout','connection'].includes(scenario))throw Error('سناریوی نمایشی معتبر نیست.');
   const ports=scenario==='errdisabled'?['Gi0/1','Gi0/2']:[];
   return {node:n,scenario,status:scenario==='clean'?'ok':scenario==='errdisabled'?'error':'unknown',ports,port:ports.map(p=>p+' (ساختگی)').join('، '),source:'سناریوی انتخابی — بدون اتصال'};
  });
 }
 function errRecoveryPlan(value,results,keys){
  const d=M.validate(value);
  if(!Array.isArray(results)||!results.length||!Array.isArray(keys)||!keys.length||keys.length>8000||new Set(keys).size!==keys.length)throw Error('ابتدا بررسی و سپس پورت‌های خطادار را انتخاب کنید.');
  const fresh=simulateErr(d,results.map(r=>r.node?.id),Object.fromEntries(results.map(r=>[r.node?.id,r.scenario])));
  if(JSON.stringify(fresh)!==JSON.stringify(results))throw Error('نتیجه یا موجودی تغییر کرده؛ دوباره بررسی کنید.');
  const allowed=new Map();for(const r of fresh)if(r.status==='error')for(const port of r.ports)allowed.set(r.node.id+':'+port,{key:r.node.id+':'+port,nodeId:r.node.id,name:r.node.name,host:r.node.host,port});
  const targets=keys.map(k=>{if(!allowed.has(k))throw Error('فقط پورت خطادارِ همان سوئیچ بررسی‌شده قابل انتخاب است.');return allowed.get(k);});
  return {targets,base:JSON.stringify(d),source:'رفع نمایشی — بدون اتصال یا فرمان'};
 }
 globalThis.FamEquipmentToolsModel=Object.freeze({columns,inventoryRows,catalogSnapshot,assertCatalogSnapshot,prepareImport,validateStandards,applicable,audit,switches,simulateErr,errRecoveryPlan});
})();
