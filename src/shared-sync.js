/* Central persistence adapter. The server, not browser storage, is authoritative.
   Snapshots are immutable per request; stale revisions never auto-rebase. */
window.FamShared=(()=>{
  let csrf='',revision=0,epoch='',ready=false,applying=false,clean='',queued=false,job=null,active=null,failure=null,polling=false,serverUserRevision='',transactionDepth=0,deferred=[],draftFailure=false,dismissedRevision=-1;
  const excluded=new Set([CP_SHEET,RESULTS_SHEET,IDX_SHEET,DD_SHEET,LOG_SHEET,UNDO_BUFFER_SHEET,NAV_SHEET_NAME]);
  const originalToast=Toast,originalMessage=ShowMsg;
  const status=el('div',{id:'shared-status',role:'status','aria-live':'polite',text:'اتصال به سرور…'});
  const liveMessage=el('p',{class:'live-update-message'});
  const liveRefresh=el('button',{type:'button',class:'btn btn-primary live-update-reload',text:'دریافت نسخهٔ جدید',onclick:()=>receiveLiveUpdate(true).catch(()=>{})});
  const liveLater=el('button',{type:'button',class:'btn btn-ghost live-update-later',text:'بعداً',onclick:()=>{dismissedRevision=Math.max(dismissedRevision,Number(liveNotice.dataset.revision||-1));hideLiveNotice();}});
  const liveNotice=el('aside',{id:'live-update-notice',role:'status','aria-live':'assertive',hidden:true},liveMessage,el('div',{class:'live-update-actions'},liveRefresh,liveLater));
  document.body.append(status,liveNotice);
  function pending(){return !!job||queued;}
  function snapshot(){
    const order=WB.order.filter(n=>!excluded.has(n));
    return {state:{v:2,order,sheets:Object.fromEntries(order.map(n=>[n,WB.sheets[n]])),lockedSheets:state.lockedSheets,categoryConfig:state.categoryConfig,regionConfig:state.regionConfig,panelProtected:state.panelProtected},undo:state.undo||null};
  }
  function signature(){return JSON.stringify(snapshot());}
  function text(message,error=false){status.textContent=message;status.classList.toggle('sync-error',error);updateSaveIndicator();}
  function freeze(message,err){
    document.getElementById('layout').inert=true;
    document.getElementById('modal-overlay').inert=true;
    let root=document.getElementById('shared-block');if(root)root.remove();
    root=el('section',{id:'shared-block',role:'alertdialog','aria-modal':'true','aria-label':'وضعیت ثبت مرکزی'});
    const box=el('div',{class:'shared-box'},el('h3',{text:err?'تغییر روی سرور تأیید نشد':'ثبت تغییر روی سرور…'}),el('p',{id:'shared-error',text:message}));
    if(err){
      box.append(el('p',{class:'hint',text:'نسخهٔ کاری در این صفحه نگه داشته شده است؛ صفحه را نبندید. بازنویسی خودکار اطلاعات دیگران انجام نمی‌شود.'}));
      if(job&&(!err.status||err.status>=500||err.status===429))box.append(el('button',{id:'shared-retry',class:'btn btn-primary',text:'تلاش دوباره با همان درخواست',onclick:()=>{failure=null;send().catch(()=>{});}}));
      if(job&&Access.can('export'))box.append(el('button',{id:'shared-recovery',class:'btn btn-ghost',text:'دانلود نسخهٔ کاریِ ثبت‌نشده',onclick:()=>DownloadFile('FAM-UNSAVED-RECOVERY.json',JSON.stringify({...job.state,undo:job.undo},null,2),'application/json')}));
      box.append(el('button',{id:'shared-reload',class:'btn btn-ghost',text:'صرف‌نظر از نسخهٔ کاری و دریافت سرور',onclick:()=>{if(!job||confirm('این تغییر روی سرور تأیید نشده است. نسخهٔ کاری این صفحه کنار گذاشته شود؟')){job=null;queued=false;location.reload();}}}));
    }
    root.append(box);document.body.append(root);
  }
  function unfreeze(){
    document.getElementById('shared-block')?.remove();
    document.getElementById('layout').inert=false;
    document.getElementById('modal-overlay').inert=false;
  }
  async function api(path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const headers={};if(body!==undefined){headers['Content-Type']='application/json';if(csrf)headers['X-FAM-CSRF']=csrf;}
      const response=await fetch(new URL('api/'+path,location.href),{method:body===undefined?'GET':'POST',headers,credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value=await response.json().catch(()=>({error:'پاسخ سرور معتبر نیست؛ مسیر API و تنظیم IIS را بررسی کنید.'}));
      if(!response.ok||value.error){const error=Error(value.error||'خطای سرور');error.status=response.ok?502:response.status;throw error;}
      return value;
    }catch(e){if(e.status)throw e;throw Error('ارتباط با سرور برقرار نشد؛ هیچ ذخیره‌ای تأیید نشده است.');}
    finally{clearTimeout(timer);}
  }
  function apply(envelope,repaint=false){
    applying=true;
    try{
      const p=envelope.state,cp={...state.cp},name=state.currentSheet,view=state.currentView;
      WB.order=APP_SHELL.order.filter(n=>excluded.has(n));WB.sheets={};
      for(const n of WB.order)WB.sheets[n]=JSON.parse(JSON.stringify(APP_SHELL.sheets[n]));
      for(const n of p.order){if(!WB.order.includes(n))WB.order.push(n);WB.sheets[n]=p.sheets[n];}
      state.lockedSheets=p.lockedSheets||{};state.categoryConfig=normalizeCategoryConfig(p.categoryConfig);state.regionConfig=normalizeRegionConfig(p.regionConfig);
      state.panelProtected=p.panelProtected!==false;state.undo=p.undo||null;state.savedAt=p.savedAt||0;state.user=Access.current().name;state.cp=cp;
      revision=envelope.revision;epoch=envelope.epoch;serverUserRevision=envelope.user.revision;
      state.results=[];
      if(repaint){
        modMapping.RefreshSearchIndex(false);initUIFromState();renderResultsView();
        if(name&&WB.sheets[name]&&Access.can('read',name)){state.currentSheet=name;renderSheetView(name);}else{state.currentSheet=null;clear(document.getElementById('sheet-body'));}
        if(Access.viewAllowed(view))switchView(view);
        Access.hideOperations();
      }
      clean=signature();text('مرکزی · نسخهٔ '+revision.toLocaleString('fa-IR')+' سرور');
    }finally{applying=false;}
  }
  async function load(){
    freeze('در حال دریافت نسخهٔ اصلی از سرور…');
    try{apply(await api('state'));unfreeze();}
    catch(err){failure=err;freeze(err.message,err);throw err;}
  }
  function queue(){
    if(!ready||applying)return true;
    if(Access.current()?.role===4)return false;
    savePanelDraft();
    if(signature()===clean&&!pending())return true;
    queued=true;text('در انتظار تأیید سرور…');
    queueMicrotask(()=>{if(queued&&!failure&&!transactionDepth)flush().catch(()=>{});});return true;
  }
  async function send(){
    if(active)return active;
    if(!job)return true;
    freeze('تا دریافت تأیید سرور، تغییر بعدی متوقف است.');text('در حال ثبت روی سرور…');
    active=(async()=>{
      try{
        const result=await api('state',job);
        revision=result.revision;epoch=result.epoch;state.savedAt=result.savedAt;state.undo=result.undo||null;clean=JSON.stringify({state:job.state,undo:state.undo});job=null;failure=null;
        text('ثبت قطعی روی سرور · نسخهٔ '+revision.toLocaleString('fa-IR'));unfreeze();
        updateStatLine();originalToast('تغییرات روی سرور ثبت شد.','ok');
        if(deferred.length){const args=deferred.at(-1);deferred=[];originalMessage(...args);}return true;
      }catch(err){failure=err;text('ثبت تأیید نشده — '+err.message,true);freeze(err.message,err);throw err;}
      finally{active=null;}
    })();return active;
  }
  async function flush(){
    if(!ready||applying)return true;
    if(transactionDepth)return false;
    if(failure)throw failure;
    if(active)await active;
    const sig=signature();
    if(!job&&sig!==clean){const snap=JSON.parse(sig);job={requestId:crypto.randomUUID(),revision,epoch,state:snap.state,undo:snap.undo};}
    queued=false;
    if(job)await send();
    else deferred=[];
    if(signature()!==clean)return flush();return true;
  }
  function liveSummary(remote){
    const actor=String(remote?.change?.actor||'').trim();
    return actor?'کاربر «'+actor+'» تغییر جدیدی ثبت کرده است.':'تغییر جدیدی روی سرور ثبت شده است.';
  }
  function hasUnsavedWork(){return pending()||signature()!==clean;}
  function liveApplyBlocked(){
    return hasUnsavedWork()||!!document.querySelector('#modal-overlay.show,dialog[open]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
  }
  function hideLiveNotice(){liveNotice.hidden=true;liveNotice.dataset.revision='';}
  function announceLiveUpdate(remote){
    if(Number(remote.revision)<=dismissedRevision)return;
    liveNotice.dataset.revision=String(remote.revision);
    liveMessage.textContent=liveSummary(remote)+' نسخهٔ '+Number(remote.revision).toLocaleString('fa-IR')+' آمادهٔ دریافت است.';
    liveNotice.hidden=false;
  }
  async function receiveLiveUpdate(force=false,remote=null){
    if(!remote)remote=await api('status');
    if(remote.revision===revision&&remote.epoch===epoch){hideLiveNotice();return true;}
    if(pending()){text('ابتدا ثبت فعلی روی سرور تأیید شود.');return false;}
    if(signature()!==clean){
      if(!force){announceLiveUpdate(remote);return false;}
      if(!confirm('تغییر ثبت‌نشدهٔ این صفحه کنار گذاشته شود و نسخهٔ جدید سرور دریافت شود؟'))return false;
      queued=false;job=null;
    }
    if(!force&&(document.querySelector('#modal-overlay.show,dialog[open]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))){announceLiveUpdate(remote);return false;}
    const data=await api('state');
    // Never overwrite a mutation that happened while the server snapshot was
    // in flight. The visible notification remains available instead.
    if(!force&&liveApplyBlocked()){announceLiveUpdate(remote);return false;}
    const y=scrollY;apply(data,true);scrollTo({top:y,behavior:'instant'});
    dismissedRevision=-1;hideLiveNotice();
    originalToast(liveSummary(remote)+' نسخهٔ جدید دریافت شد.','ok');
    return true;
  }
  async function poll(){
    if(!ready||polling||failure||pending()||document.hidden)return;
    polling=true;
    try{
      const remote=await api('status');
      if(remote.userRevision!==serverUserRevision){const e=Error('حساب یا دسترسی شما تغییر کرده است؛ دوباره وارد شوید.');e.status=401;throw e;}
      if(remote.revision===revision&&remote.epoch===epoch){hideLiveNotice();text('مرکزی · نسخهٔ '+revision.toLocaleString('fa-IR')+' سرور');return;}
      if(liveApplyBlocked()){
        text(liveSummary(remote)+' پس از پایان کار فعلی دریافت می‌شود.');announceLiveUpdate(remote);return;
      }
      await receiveLiveUpdate(false,remote);
    }catch(err){
      text(err.message,true);
      if(err.status===401||err.status===403){failure=err;freeze(err.message,err);}
    }finally{polling=false;}
  }
  function start(){ready=true;clean=signature();unfreeze();text('مرکزی · نسخهٔ '+revision.toLocaleString('fa-IR')+' سرور');window.dispatchEvent(new Event('fam-shared-ready'));setInterval(poll,2000);}
  // Trusted previous server snapshot, not a client-supplied Undo buffer.
  modUndo.UndoLastRemove=async()=>{
    if(!Access.require('admin'))return false;
    const previous=await api('undo-state');
    const yes=await originalMessage('بازگردانی کامل آخرین ثبت سرور (نسخهٔ '+previous.revision+') توسط «'+previous.actor+'»؟\nبخش‌ها: '+(previous.sheets||'تنظیمات')+'\nاین عملیات فقط حذف ردیف نیست؛ کل همان ثبت برگردانده می‌شود.',vbYesNo|vbQuestion,'بازگشت آخرین ثبت سرور');
    if(yes!==IDYES)return false;
    if(previous.revision!==revision||previous.epoch!==epoch)throw Error('نسخهٔ سرور تغییر کرده است؛ ابتدا نسخهٔ تازه را دریافت کنید.');
    const baseline=clean;apply(previous,true);clean=baseline;queue();return true;
  };
  // No business workbook or account is read from / persisted to browser storage.
  const nativeSnapshot=snapshotWorkbook,nativeRestore=restoreWorkbook;
  snapshotWorkbook=()=>({...nativeSnapshot(),sharedMeta:JSON.parse(JSON.stringify({lockedSheets:state.lockedSheets,categoryConfig:state.categoryConfig,regionConfig:state.regionConfig,panelProtected:state.panelProtected}))});
  restoreWorkbook=snap=>{nativeRestore(snap);if(snap.sharedMeta)Object.assign(state,snap.sharedMeta);};
  const nativeSync=withTransactionSync,nativeAsync=withTransaction;
  withTransactionSync=function(...args){transactionDepth++;try{return nativeSync.apply(this,args);}finally{transactionDepth--;if(!transactionDepth&&queued)queueMicrotask(()=>flush().catch(()=>{}));}};
  withTransaction=async function(...args){transactionDepth++;let result;try{result=await nativeAsync.apply(this,args);}finally{transactionDepth--;}if(!transactionDepth&&queued)await flush();return result;};
  saveState=queue;flushDeepSave=flush;loadState=()=>false;loadDeepState=async()=>false;scheduleDeepSave=()=>{};idbPut=async()=>false;idbGet=async()=>null;idbDelete=async()=>true;
  savePanelDraft=()=>{try{if(Access.current())localStorage.setItem('fam.shared.draft.'+Access.current().id,JSON.stringify({C11:state.cp.C11,C27:state.cp.C27}));draftFailure=false;return true;}catch(_){if(!draftFailure)originalToast('پیش‌نویس ورودی در حافظهٔ مرورگر ماندگار نشد؛ پیش از خروج آن را یادداشت کنید.','warn');draftFailure=true;return false;}};
  restorePanelDraft=()=>{try{if(!Access.current())return false;const p=JSON.parse(localStorage.getItem('fam.shared.draft.'+Access.current().id)||'null');if(typeof p?.C11==='string'&&typeof p.C27==='string'){state.cp.C11=p.C11;state.cp.C27=p.C27;return true;}}catch(_){}return false;};
  updateSaveIndicator=()=>{const n=document.getElementById('save-indicator');if(n){n.textContent=failure?'ثبت نشده':pending()?'در انتظار سرور…':'نسخهٔ مرکزی '+revision.toLocaleString('fa-IR');n.title='ذخیره‌سازی مرکزی روی سرور؛ نه حافظهٔ این مرورگر';}};
  const nativeEmpty=resetToEmptyData;
  resetToEmptyData=skipConfirm=>{
    if(!Access.require('empty-data'))return false;
    const perform=()=>withTransactionSync(()=>{state.lockedSheets={};return nativeEmpty(true);});
    if(skipConfirm===true)return perform();
    ConfirmBox('پاک‌سازی داده‌های مشترک','تمام داده‌های مشترک روی سرور برای همهٔ کاربران پاک می‌شود. حساب‌ها باقی می‌مانند. ابتدا پشتیبان بگیرید. ادامه می‌دهید؟',perform);return true;
  };
  resetAll=()=>{
    if(!Access.require('reset'))return false;
    ConfirmBox('بازنشانی مرکزی','همهٔ داده‌ها و پیکربندی دسته‌ها/مناطق روی سرور برای همهٔ کاربران بازنشانی می‌شود؛ حساب‌ها و فایل Excel اصلی تغییر نمی‌کنند. قبل از ادامه پشتیبان بگیرید. مطمئنید؟',()=>withTransactionSync(()=>{
      state.categoryConfig=null;state.regionConfig=null;state.panelProtected=true;state.cp.C11='';state.cp.C27='';resetToEmptyData(true);
    }));return true;
  };
  // In central mode the backup tool creates a verified SQLite snapshot inside
  // C:\\FAMData\\backups. It does not download sensitive server data into a
  // workstation browser. Flush first, so the requested snapshot includes this
  // administrator's just-finished work as well.
  backupAll=async()=>{
    if(!Access.require('backup'))return false;
    try{
      if(pending()||signature()!==clean){
        originalToast('ابتدا تغییرات این صفحه روی سرور ثبت می‌شود…','warn');
        queue();if(!await flush())return false;
      }
      const result=await api('backups',{});
      originalToast('پشتیبان کامل روی سرور ثبت شد: '+result.filename,'ok');
      return true;
    }catch(err){originalToast(err.message||'پشتیبان‌گیری روی سرور ناموفق بود.','err');return false;}
  };
  saveNow=async()=>{if(!Access.require('save-results'))return false;try{queue();if(!await flush())return false;originalToast('نسخهٔ '+revision+' روی سرور تأیید شده است.','ok');return true;}catch(_){return false;}};
  verifyLocalPassword=async password=>{try{await api('reauth',{password});return true;}catch(_){return false;}};
  Toast=(message,type)=>{if(type==='ok'&&ready&&(pending()||signature()!==clean))return;originalToast(message,type);};
  ShowMsg=async(...args)=>{if(transactionDepth&&signature()!==clean&&!(Number(args[1])&vbCritical)&&!(Number(args[1])&15)){deferred.push(args);return IDOK;}if(ready&&!applying&&(pending()||signature()!==clean)&&!(Number(args[1])&vbCritical)){try{await flush();}catch(_){return IDCANCEL;}}return originalMessage(...args);};
  window.addEventListener('beforeunload',e=>{if(pending()||draftFailure){e.preventDefault();e.returnValue='';}});
  return {api,identity:value=>{serverUserRevision=value;},setCsrf:value=>{csrf=value;},load,ready:start,flush,poll,revision:()=>revision,pending};
})();
