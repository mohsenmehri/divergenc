/* Separate provincial destinations. Existing province sheets remain Branch;
   only confirmed new ATM records create/use an ATM sheet. No historic splitting.
   Names encode the section so Excel/CSV/JSON round-trips retain the routing. */
function provinceSheetInfo(name) {
  let base=String(name||'').trim(),section='branch';
  if(/^خودپرداز\s+/.test(base)){section='atm';base=base.replace(/^خودپرداز\s+/,'');}
  else base=base.replace(/^(?:شعبه|شعب)\s+/,'');
  const province=managedProvinces().find(p=>p.aliases.includes(provinceKey(base)));
  return province ? {province,section} : null;
}
function provinceSectionSheets(id,section) {
  return WB.order.filter(name=>{
    const info=provinceSheetInfo(name);
    return SheetExists(name) && info?.province.id===id && info.section===section;
  });
}
function provincialHeaderTemplate(sourceName) {
  const source=WB.sheets[sourceName];
  if(!source?.rows?.length)throw Error('قالب ستون‌های استان موجود نیست؛ ابتدا شیت شعبهٔ همان استان را وارد کنید.');
  // Only the existing header row, its column positions and header-only merges.
  // Never copy source records, totals or historical ATM sections into the new sheet.
  const template={rows:[JSON.parse(JSON.stringify(source.rows[0]||[]))],merges:[]};
  template.merges=(source.merges||[]).filter(m=>m.r1===1&&m.r2===1).map(m=>({...m}));
  if(!template.rows[0].some(v=>TrimText(v)))throw Error('سطر عنوان ستون‌های استان خالی است.');
  if(template.rows[0].length>MAX_DATA_COLS)throw Error('تعداد ستون‌های قالب بیش از حد مجاز است.');
  return template;
}
function nextProvincialRow(sheet) {
  // All existing rows belong to Branch, even when the old workbook contains an
  // ATM separator. Append after the last record (or before a trailing total).
  let last=sheet.rows.length;
  while(last>1 && !(sheet.rows[last-1]||[]).some(v=>v!==null&&v!==undefined&&String(v).trim()))last--;
  const total=last>1&&(sheet.rows[last-1]||[]).some(v=>/^(?:جمع|مجموع)(?:\s|$)/.test(TrimText(v)));
  let row=total?last:last+1;
  for(const m of sheet.merges||[])if(m.r1<row&&m.r2>=row)row=m.r2+1;
  return Math.max(2,row);
}
async function startProvinceAdd(selectedName) {
  if(!Access.require('add'))return;
  const origin=provinceSheetInfo(selectedName);
  if(!origin||!SheetExists(selectedName))return;
  const section=await modAddRecord.SectionPicker(origin.province.name);
  if(!['branch','atm'].includes(section)||!Access.require('add'))return;
  const candidates=provinceSectionSheets(origin.province.id,section);
  let destination=origin.section===section?selectedName:candidates.length===1?candidates[0]:null;
  if(!destination&&candidates.length>1){
    await ShowMsg('برای این استان چند شیت در این بخش وجود دارد. ابتدا شیت مقصد را در فهرست «افزودن رکورد» انتخاب کنید.',vbExclamation,'انتخاب شیت مقصد');return;
  }
  let draft=null,sourceName=null;
  if(!destination){
    const branches=provinceSectionSheets(origin.province.id,'branch');
    sourceName=origin.section==='branch'?selectedName:branches.length===1?branches[0]:null;
    if(!sourceName){await ShowMsg('برای ساخت قالب، ابتدا شیت شعبهٔ همین استان را وارد و انتخاب کنید.',vbExclamation,'قالب استان');return;}
    destination=(section==='atm'?'خودپرداز ':'شعبه ')+origin.province.name;
    if(destination.length>31 || WB.order.some(n=>NormalizeText(n)===NormalizeText(destination))){
      await ShowMsg('نام شیت مقصد تکراری یا نامعتبر است؛ هیچ داده‌ای تغییر نکرد.',vbExclamation,'شیت مقصد');return;
    }
    try{draft=provincialHeaderTemplate(sourceName);}catch(e){await ShowMsg(e.message,vbExclamation,'قالب استان');return;}
  }
  const target=draft||WB.sheets[destination];
  const fingerprint=JSON.stringify(target);
  const headers=[],columns=[];
  (target.rows[0]||[]).forEach((value,i)=>{
    // A merged header has one input at its anchor, not several duplicate fields.
    if((target.merges||[]).some(m=>m.r1===1&&m.c1<i+1&&m.c2>=i+1))return;
    if(TrimText(value)){headers.push(TrimText(value));columns.push(i+1);}
  });
  if(!headers.length){await ShowMsg('شیت مقصد عنوان ستون ندارد.',vbExclamation,'افزودن رکورد');return;}
  const row=nextProvincialRow(target),label=section==='atm'?'خودپرداز':'شعبه';
  const form=el('div',{},el('p',{class:'hint',text:origin.province.name+' / '+label+' — شیت مقصد: '+destination}),
    draft?el('p',{class:'hint',text:'قالب ستون‌ها از «'+sourceName+'» گرفته شده است. شیت جدید فقط پس از تأیید نهایی ساخته می‌شود.'}):null,
    el('div',{class:'wizard-fields'},headers.map((header,i)=>el('div',{class:'wf'},el('label',{text:header}),el('input',{'data-i':i,value:'',placeholder:'(خالی = Skip)'})))));
  const values=await modAddRecord.WizardAddForm(form);
  if(values===null || !Access.require('add'))return;
  if(!values.some(v=>TrimText(v))){await ShowMsg('هیچ مقداری وارد نشد.',vbExclamation,'افزودن رکورد');return;}
  const preview='استان: '+origin.province.name+'\nبخش: '+label+'\nشیت مقصد: '+destination+'\n\n'+headers.map((h,i)=>values[i]?h+': '+values[i]:'').filter(Boolean).join('\n')+'\n\nآیا ذخیره شود؟';
  if(await ShowMsg(preview,vbYesNo|vbQuestion,'CONFIRM ADD')!==IDYES || !Access.require('add'))return;
  // Recheck the live destination after every asynchronous user interaction.
  let sourceUnchanged=true;
  if(draft){try{sourceUnchanged=SheetExists(sourceName)&&JSON.stringify(provincialHeaderTemplate(sourceName))===fingerprint;}catch(e){sourceUnchanged=false;}}
  if((draft&&WB.order.some(n=>NormalizeText(n)===NormalizeText(destination))) ||
      (!draft&&JSON.stringify(WB.sheets[destination])!==fingerprint) ||
      (draft&&!sourceUnchanged)){
    await ShowMsg('شیت یا قالب در حین ورود اطلاعات تغییر کرده است؛ لطفاً دوباره فرم را باز کنید.',vbExclamation,'تغییر هم‌زمان');return;
  }
  const ok=withTransactionSync({action:'ADD_PROVINCE',sheet:destination},()=>{
    if(draft){WB.sheets[destination]=JSON.parse(JSON.stringify(draft));WB.order.push(destination);}
    insertRowAt(destination,row);
    values.forEach((value,i)=>{if(value)setCellVal(destination,row,columns[i],value,false);});
    WriteChangeLog('ADD',destination,String(row),'SUCCESS',label+' / '+origin.province.name);
    const cfg=ensureSheet(CFG_SHEET,true);
    if(!cfg.rows.length)cfg.rows.push(['Sheet','Rows','Columns','Header','DataStart','Confidence']);
    ensureCfgRow(cfg,destination,WB.sheets[destination]);
    RefreshSearchIndexSilent();return true;
  });
  if(!ok)return;
  modUI.SetupSheetDropdown();modUI.SetupAddSheetDropdown();modUI.SetupNavSheetDropdown();
  state.cp.C16=destination;document.getElementById('cp-c16').value=destination;syncQuickForms();saveState();
  await ShowMsg('رکورد در «'+destination+'» ذخیره شد.',vbInformation,'افزودن داده — انجام شد');
  state.catFilter='provinces';switchView('sheet');renderSheetView(destination);saveUIState();
}
