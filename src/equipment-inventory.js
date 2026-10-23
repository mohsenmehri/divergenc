/* Pure local inventory model. Contains no login/credential handling or network code. */
(()=>{
  'use strict';
  const fields=['typeId','modelId','regionId','siteKindId','siteId'];
  const dimensions={types:'نوع تجهیز',models:'مدل تجهیز',regions:'منطقه',siteKinds:'نوع محل',sites:'محل استقرار'};
  const uid=()=>crypto.randomUUID();
  // Legacy API name retained: RFC1918 + authorized building/shared 100.64/10.
  const privateIP=value=>{
    if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value))return false;
    const p=value.split('.').map(Number);return p.every(n=>n<=255)&&(p[0]===10||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127);
  };
  const validName=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80&&!/[\x00-\x1f\x7f]/.test(value);
  function defaults(){
    const types=[{id:'type-router',name:'روتر',kind:'router'},{id:'type-switch',name:'سوئیچ',kind:'switch'}];
    const siteKinds=[{id:'kind-branch',name:'شعبه',kind:'branch'},{id:'kind-building',name:'ساختمان اداره',kind:'building'},{id:'kind-datacenter',name:'دیتا سنتر',kind:'datacenter'},{id:'kind-area',name:'حوزه',kind:'other'},{id:'kind-other',name:'انبار و غیره',kind:'other'}];
    const buildings=['ساختمان مرکزی رضوان','ساختمان 68 شرقی فام','ساختمان 68 شرقی ملل','ساختمان 68 شرقی شرکت ها','ساختمان مرکزی فام','ساختمان ملاصدرا فام'];
    return {version:3,catalog:{types,models:[{id:'model-1841',name:'1841',typeId:'type-router'},{id:'model-1300',name:'1300',typeId:'type-router'},{id:'model-2960',name:'2960',typeId:'type-switch'}],regions:[1,2,3,4].map(n=>({id:'region-'+n,name:'منطقه '+n})),siteKinds,sites:[...buildings.map((name,i)=>({id:'building-'+i,name,siteKindId:'kind-building'})),...['تهران','سمنان'].map((name,i)=>({id:'datacenter-'+i,name,siteKindId:'kind-datacenter'}))]},nodes:[]};
  }
  function validate(value){
    if(!value||value.version!==3||!value.catalog||!Array.isArray(value.nodes)||value.nodes.length>4000)throw Error('فهرست تجهیزات معتبر نیست.');
    const ids=new Set();let size=0;
    const identity=item=>{
      if(!item||typeof item.id!=='string'||!/^[\w-]{1,80}$/.test(item.id)||ids.has(item.id)||!validName(item.name)||++size>12000)throw Error('شناسه یا نام معتبر نیست.');
      ids.add(item.id);return {id:item.id,name:item.name.trim()};
    };
    const catalog={};
    for(const key of Object.keys(dimensions)){
      if(!Array.isArray(value.catalog[key])||value.catalog[key].length>2000)throw Error('دسته‌بندی معتبر نیست.');
      catalog[key]=value.catalog[key].map(item=>{
        const clean=identity(item);
        if(key==='types'||key==='siteKinds'){
          const allowed=key==='types'?['router','switch','other']:['branch','building','datacenter','other'];
          if(!allowed.includes(item.kind))throw Error('الگوی دسته معتبر نیست.');clean.kind=item.kind;
        }
        if(key==='models'){if(typeof item.typeId!=='string'||!catalog.types.some(t=>t.id===item.typeId))throw Error('نوعِ مدل معتبر نیست.');clean.typeId=item.typeId;}
        if(key==='sites'){if(typeof item.siteKindId!=='string'||!catalog.siteKinds.some(t=>t.id===item.siteKindId))throw Error('نوع محل معتبر نیست.');clean.siteKindId=item.siteKindId;}
        return clean;
      });
      const names=new Set();for(const item of catalog[key]){const keyName=(item.typeId||item.siteKindId||'')+'\u0000'+item.name;if(names.has(keyName))throw Error('نام تکراری در همین دسته وجود دارد.');names.add(keyName);}
    }
    const lists={typeId:'types',modelId:'models',regionId:'regions',siteKindId:'siteKinds',siteId:'sites'};
    const nodes=value.nodes.map(item=>{
      const clean=identity(item);if(!privateIP(item.host))throw Error('IP داخلی مجاز معتبر نیست.');clean.host=item.host;
      for(const field of fields){const ref=item[field];if(ref!==null&&(typeof ref!=='string'||!catalog[lists[field]].some(entry=>entry.id===ref)))throw Error('ارجاع دستهٔ تجهیز معتبر نیست.');clean[field]=ref;}
      if(clean.modelId&&catalog.models.find(m=>m.id===clean.modelId).typeId!==clean.typeId)throw Error('مدل باید متعلق به نوع تجهیز انتخاب‌شده باشد.');
      if(clean.siteId&&catalog.sites.find(m=>m.id===clean.siteId).siteKindId!==clean.siteKindId)throw Error('محل باید متعلق به نوع محل انتخاب‌شده باشد.');
      if(item.legacyPath!==undefined){if(typeof item.legacyPath!=='string'||item.legacyPath.length>300||/[\x00-\x1f\x7f]/.test(item.legacyPath))throw Error('مسیر قبلی معتبر نیست.');clean.legacyPath=item.legacyPath;}
      return clean;
    });
    return {version:3,catalog,nodes};
  }
  const incomplete=node=>fields.some(field=>!node[field]);
  const matches=(node,filters)=>fields.every(field=>!filters[field]||node[field]===filters[field]);
  function upsertNode(value,node){
    const next=structuredClone(value);
    if(fields.some(field=>!node[field]))throw Error('نوع، مدل، منطقه، نوع محل و محل استقرار را مشخص کنید.');
    if(next.nodes.some(n=>n.id!==node.id&&n.host===node.host))throw Error('این IP قبلاً در فهرست تجهیزات ثبت شده است.');
    const index=next.nodes.findIndex(n=>n.id===node.id);
    if(index<0)next.nodes.push(node);else next.nodes[index]=node;
    return validate(next);
  }
  function removeCategory(value,key,id){
    const next=structuredClone(value),refs={types:'typeId',models:'modelId',regions:'regionId',siteKinds:'siteKindId',sites:'siteId'};
    if(!refs[key])throw Error('دسته معتبر نیست.');
    if(next.nodes.some(n=>n[refs[key]]===id))throw Error('این دسته در تجهیزات استفاده شده است؛ ابتدا تجهیزات را ویرایش یا از دسته خارج کنید.');
    if(key==='types'&&next.catalog.models.some(m=>m.typeId===id))throw Error('ابتدا مدل‌های وابسته به این نوع تجهیز را حذف یا جابه‌جا کنید.');
    if(key==='siteKinds'&&next.catalog.sites.some(m=>m.siteKindId===id))throw Error('ابتدا محل‌های وابسته را حذف یا جابه‌جا کنید.');
    next.catalog[key]=next.catalog[key].filter(item=>item.id!==id);return validate(next);
  }
  function unassign(value,id,field){
    if(!fields.includes(field))throw Error('دسته معتبر نیست.');
    const next=structuredClone(value),node=next.nodes.find(n=>n.id===id);if(!node)throw Error('تجهیز پیدا نشد.');
    node[field]=null;if(field==='typeId')node.modelId=null;if(field==='siteKindId')node.siteId=null;
    return validate(next);
  }
  function migrateV2(old){
    if(!old||old.version!==2||!Array.isArray(old.types)||old.types.length>30)throw Error('فهرست قبلی قابل تبدیل نیست.');
    const next=defaults(),seen=new Set();let count=0;
    const check=item=>{if(!item||typeof item.id!=='string'||seen.has(item.id)||!validName(item.name)||++count>6000)throw Error('دادهٔ نسخهٔ قبلی معتبر نیست.');seen.add(item.id);};
    const findOrAdd=(key,name,props)=>{let item=next.catalog[key].find(item=>item.name===name&&Object.entries(props).every(([key,value])=>item[key]===value));if(!item){item={id:uid(),name,...props};next.catalog[key].push(item);}return item;};
    for(const t of old.types){
      check(t);if(!['router','switch','other'].includes(t.kind)||!Array.isArray(t.categories)||t.categories.length>100)throw Error('نوع قبلی معتبر نیست.');
      const type=findOrAdd('types',t.name,{kind:t.kind});
      for(const c of t.categories){
        check(c);if(!Array.isArray(c.nodes)||!Array.isArray(c.sections)||c.sections.length>100)throw Error('گروه قبلی معتبر نیست.');
        const transfer=(nodes,section)=>{
          if(nodes.length>2000)throw Error('تعداد تجهیزاتی قبلی معتبر نیست.');
          for(const n of nodes){
            check(n);if(!privateIP(n.host))throw Error('IP نسخهٔ قبلی معتبر نیست.');
            let kind=null,site=null;
            if(/ساختمان/.test(c.name)){
              kind=next.catalog.siteKinds.find(k=>k.kind==='building');if(section)site=findOrAdd('sites',section.name,{siteKindId:kind.id});
            }else if(/دیتا|سنتر/.test(c.name)){
              kind=next.catalog.siteKinds.find(k=>k.kind==='datacenter');if(section)site=findOrAdd('sites',section.name,{siteKindId:kind.id});
            }else if(/شعبه|حوزه/.test(c.name)&&section){
              kind=next.catalog.siteKinds.find(k=>k.name===section.name)||findOrAdd('siteKinds',section.name,{kind:'other'});
            }else{
              kind=findOrAdd('siteKinds',c.name,{kind:'other'});if(section)site=findOrAdd('sites',section.name,{siteKindId:kind.id});
            }
            next.nodes.push({id:n.id,name:n.name,host:n.host,typeId:type.id,modelId:null,regionId:null,siteKindId:kind?.id||null,siteId:site?.id||null,legacyPath:[t.name,c.name,section?.name].filter(Boolean).join(' / ')});
          }
        };
        transfer(c.nodes,null);for(const section of c.sections){check(section);if(!Array.isArray(section.nodes))throw Error('زیر‌بخش قبلی معتبر نیست.');transfer(section.nodes,section);}
      }
    }
    return validate(next);
  }
  // Display shortcuts are separate from node/catalog storage. Removing a card never
  // removes a category. References may become stale after a catalog deletion;
  // the UI then asks the user to repair the shortcut rather than rewriting it.
  const cardFields=Object.freeze({types:'typeId',models:'modelId',regions:'regionId',siteKinds:'siteKindId',buildings:'siteId',datacenters:'siteId'});
  function defaultCards(){
    return {version:1,cards:[['types','نوع تجهیز'],['models','مدل تجهیز'],['regions','منطقه'],['siteKinds','نوع محل'],['buildings','ساختمان‌ها'],['datacenters','دیتا سنتر']].map(([facet,name])=>({id:'view-'+facet,name,facet,refId:null}))};
  }
  function validateCards(value){
    if(!value||value.version!==1||!Array.isArray(value.cards)||value.cards.length>60)throw Error('فهرست کارت‌ها معتبر نیست؛ حداکثر ۶۰ کارت مجاز است.');
    const ids=new Set();
    return {version:1,cards:value.cards.map(card=>{
      if(!card||typeof card.id!=='string'||!/^[\w-]{1,80}$/.test(card.id)||ids.has(card.id)||!validName(card.name)||typeof card.facet!=='string'||!Object.hasOwn(cardFields,card.facet)||card.refId!==null&&(typeof card.refId!=='string'||!/^[\w-]{1,80}$/.test(card.refId)))throw Error('نام یا مقصد کارت معتبر نیست.');
      ids.add(card.id);return {id:card.id,name:card.name.trim(),facet:card.facet,refId:card.refId};
    })};
  }
  globalThis.FamEquipmentInventory=Object.freeze({fields,dimensions,privateIP,validName,defaults,validate,incomplete,matches,upsertNode,removeCategory,unassign,migrateV2,cardFields,defaultCards,validateCards});
})();
