/* Dynamic LOCAL XLSX, built solely from the CURRENT canonical catalog.
   Uses bundled SheetJS/CFB; no static workbook, external assets, macros or network. */
(()=>{
 'use strict';const M=FamEquipmentInventory,T=FamEquipmentToolsModel;
 const META='اطلاعات قالب',LISTS='فهرست‌ها';
 function build(value,{includeNodes=false,generatedAt=new Date().toISOString()}={}){
  const d=M.validate(value),book=XLSX.utils.book_new(),add=(title,rows,cols=[])=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=cols.map(wch=>({wch}));XLSX.utils.book_append_sheet(book,ws,title);};
  add('تجهیزات',includeNodes?T.inventoryRows(d):[T.columns.slice()],[28,20,24,18,24,24,24,20,38,40]);
  const lookup=(key,id)=>d.catalog[key].find(x=>x.id===id)?.name||'';
  const catalogs=[['بخش','نام مجاز فعلی','الگو','وابسته به']];
  for(const [key,title]of [['types','نوع تجهیز'],['models','مدل تجهیز'],['regions','منطقه'],['siteKinds','نوع محل'],['sites','محل استقرار']])for(const item of d.catalog[key])catalogs.push([title,item.name,item.kind||'',item.typeId?lookup('types',item.typeId):item.siteKindId?lookup('siteKinds',item.siteKindId):'']);
  add('راهنما',[
   ['فرم پویای ورود تجهیزات FAM — بدون رمز'],['زمان دریافت',generatedAt],['این فایل از آخرین دسته‌بندی‌های همین موجودی ساخته شده است؛ فایل ثابت نیست.'],
   ['۱. ردیف ۲ به بعد برگه تجهیزات را تکمیل کنید؛ سرستون‌ها را تغییر ندهید.'],['۲. نام‌های مجاز و وابستگی‌ها در برگه دسته‌ها هستند؛ مدل و محل منوی وابسته به نوع دارند.'],
   ['۳. الگوی نوع: router / switch / other. الگوی محل: branch / building / datacenter / other. الگوی دقیق هر دسته در برگه دسته‌ها آمده است.'],
   ['۴. همهٔ ستون‌ها به جز شناسه نود لازم‌اند. برای افزودن، شناسه خالی؛ برای ویرایش از خروجی موجودی و حالت به‌روزرسانی استفاده کنید.'],
   ['۵. ابتدا در ابزارها پیش‌نمایش و سپس تأیید کنید. هیچ نود خارج از فایل حذف نمی‌شود.'],['۶. اگر دسته‌ها را پس از دریافت فایل تغییر دادید، فرم جدید بگیرید و فقط ردیف‌های تجهیزات را منتقل کنید.'],
   ['برگه‌های مخفیِ فهرست‌ها و اطلاعات قالب را حذف یا ویرایش نکنید. تغییر نودها به‌تنهایی قالب را قدیمی نمی‌کند؛ تغییر دسته‌ها می‌کند.'],
   ['نمونه‌ها از دسته‌های فعلی ساخته می‌شوند و خودکار وارد نمی‌شوند. اگر دسته‌های لازم وجود ندارند، ابتدا آن‌ها را در برنامه تعریف کنید.'],
   ['حداکثر ۴۰۰۰ ردیف، ۵ مگابایت، بدون فرمول؛ هیچ رمز یا کانفیگ در فایل ننویسید.'],
   ['ساخت دستهٔ جدید از ردیف‌های اکسل فقط با فعال‌کردن گزینهٔ صریح در برنامه مجاز است؛ فهرست‌های خود قالب را دست‌کاری نکنید.']
  ],[115,32]);
  add('دسته‌ها',catalogs,[22,40,20,40]);
  const examples=[T.columns.slice()],region=d.catalog.regions[0],kind=d.catalog.siteKinds.find(k=>d.catalog.sites.some(s=>s.siteKindId===k.id));
  if(region&&kind){const site=d.catalog.sites.find(s=>s.siteKindId===kind.id);for(const type of d.catalog.types.filter(t=>d.catalog.models.some(m=>m.typeId===t.id)).slice(0,3)){
   const model=d.catalog.models.find(m=>m.typeId===type.id);examples.push(['نمونه ساختگی '+examples.length,'10.20.0.'+examples.length,type.name,type.kind,model.name,region.name,kind.name,kind.kind,site.name,'']);
  }}add('مثال',examples,[28,20,24,18,24,24,24,20,38,40]);
  const lists=[['نوع تجهیز','الگوی نوع','مدل','منطقه','نوع محل','الگوی محل','محل','خالی','نوع','فهرست مدل','','نوع محل','فهرست محل']];
  const set=(r,c,v)=>{lists[r]??=[];lists[r][c]=v;};
  const names=[],named=(name,col,len)=>{const letter=XLSX.utils.encode_col(col);names.push({Name:name,Ref:"'"+LISTS+"'!$"+letter+'$2:$'+letter+'$'+Math.max(2,len+1)});};
  const fill=(col,name,values)=>{values.forEach((v,i)=>set(i+1,col,v));named(name,col,values.length);};
  set(1,7,'');named('FamEmpty',7,1);
  fill(0,'FamTypes',d.catalog.types.map(x=>x.name));fill(1,'FamTypeKinds',['router','switch','other']);fill(2,'FamModels',d.catalog.models.map(x=>x.name));fill(3,'FamRegions',d.catalog.regions.map(x=>x.name));fill(4,'FamSiteKinds',d.catalog.siteKinds.map(x=>x.name));fill(5,'FamSitePatterns',['branch','building','datacenter','other']);fill(6,'FamSites',d.catalog.sites.map(x=>x.name));
  let col=13;
  d.catalog.types.forEach((t,i)=>{const key='FamModel_'+i;set(i+1,8,t.name);set(i+1,9,key);set(0,col,key);fill(col++,key,d.catalog.models.filter(m=>m.typeId===t.id).map(m=>m.name));});
  d.catalog.siteKinds.forEach((k,i)=>{const key='FamSite_'+i;set(i+1,11,k.name);set(i+1,12,key);set(0,col,key);fill(col++,key,d.catalog.sites.filter(s=>s.siteKindId===k.id).map(s=>s.name));});
  add(LISTS,lists);add(META,T.catalogSnapshot(d),[24,45,40,18,45]);
  book.Workbook={Names:names,Sheets:book.SheetNames.map(name=>({name,Hidden:[LISTS,META].includes(name)?1:0}))};
  names.push({Name:'FamTypeMap',Ref:"'"+LISTS+"'!$I$2:$J$"+Math.max(2,d.catalog.types.length+1)},{Name:'FamSiteMap',Ref:"'"+LISTS+"'!$L$2:$M$"+Math.max(2,d.catalog.siteKinds.length+1)});
  const dependent=(cell,map)=>'INDIRECT(IFERROR(VLOOKUP('+cell+','+map+',2,FALSE),"FamEmpty"))';
  const validations=[['C','FamTypes'],['D','FamTypeKinds'],['E',dependent('$C2','FamTypeMap')],['F','FamRegions'],['G','FamSiteKinds'],['H','FamSitePatterns'],['I',dependent('$G2','FamSiteMap')]];
  return {book,validations};
 }
 const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 function encode(value,options){
  const {book,validations}=build(value,options),raw=XLSX.write(book,{type:'array',bookType:'xlsx',compression:true});
  const zip=XLSX.CFB.read(new Uint8Array(raw),{type:'array'}),path='xl/worksheets/sheet1.xml',entry=XLSX.CFB.find(zip,'/'+path);
  if(!entry)throw Error('ساخت فرم اکسل انجام نشد.');let xml=new TextDecoder().decode(entry.content);
  // SheetJS CE does not write data validations; add standard OOXML list rules
  // through its bundled ZIP utility. Only generated names/ranges enter formulas.
  const dv='<dataValidations count="'+validations.length+'">'+validations.map(([col,formula])=>'<dataValidation type="list" allowBlank="1" showErrorMessage="0" showInputMessage="1" promptTitle="'+escape('نام دقیق دسته')+'" prompt="'+escape('انتخاب از فهرست دسته‌های فعلی')+'" sqref="'+col+'2:'+col+'4001"><formula1>'+escape(formula)+'</formula1></dataValidation>').join('')+'</dataValidations>';
  xml=xml.replace(/<(?:hyperlinks\b|printOptions\b|pageMargins\b|ignoredErrors\b|drawing\b)|<\/worksheet>/,match=>dv+match);
  entry.content=new TextEncoder().encode(xml);entry.size=entry.content.length;return new Uint8Array(XLSX.CFB.write(zip,{type:'array',fileType:'zip',compression:true}));
 }
 function download(value,options){const bytes=encode(value,options),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download=options?.includeNodes?'FAM-Equipment-Export.xlsx':'FAM-Equipment-Template.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function read(buffer){
  let book,sheet,rows,snapshot;
  try{book=XLSX.read(buffer,{type:'array',sheets:['تجهیزات',META],sheetRows:10003,cellFormula:true,cellHTML:false,cellStyles:false,bookVBA:false});sheet=book.Sheets['تجهیزات'];if(!sheet)throw Error();
   const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');if(range.e.r>4000||range.e.c>9)throw Error();
   for(const [key,cell]of Object.entries(sheet))if(!key.startsWith('!')&&cell.f)throw Error();rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true});
   const meta=book.Sheets[META];if(meta){const r=XLSX.utils.decode_range(meta['!fullref']||meta['!ref']||'A1');if(r.e.r>10001||r.e.c>4)throw Error();for(const [key,cell]of Object.entries(meta))if(!key.startsWith('!')&&cell.f)throw Error();snapshot=XLSX.utils.sheet_to_json(meta,{header:1,raw:true,defval:'',blankrows:true});}
  }catch(e){throw Error('فایل قابل ورود نیست؛ برگهٔ تجهیزات، اندازه و نبود فرمول را بررسی کنید.');}
  return {rows,snapshot};
 }
 globalThis.FamEquipmentExcel=Object.freeze({build,encode,download,read});
})();
