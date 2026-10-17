"""Build the central IIS client from the standalone two-theme FAM source.

The central client deliberately replaces browser-local accounts/persistence with
``src/shared-access.js`` and ``src/shared-sync.js``.  Keeping that adapter as a
separate source file makes server builds reproducible while avoiding accidental
reintroduction of browser-local credentials into the deployable client.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
s=(root/'FAM.html').read_text()
# Equipment metadata uses a server-backed facade, never browser inventory or
# accounts. The existing UI has explicit pending/failed central commit blocking.
for module in ('equipment-local-preview','equipment-tools'):
    source=(root/f'src/{module}.js').read_text().replace('localStorage','FamEquipmentServer.storage')
    if module=='equipment-local-preview':
        source=source.replace("if(!credentials){gate();return;}","if(!credentials)credentials={userId:Access.current()?.id,username:'demo-only',password:''};")
        source=source.replace("'RADIUS آماده است'","'نشست کاربری سرور'").replace("'معتبر تا خروج از حساب FAM · فقط در حافظه'","'تجهیزات مرکزی · بررسی پورت‌ها با SSH واقعی'").replace("'تغییر اطلاعات RADIUS'","'بازنشانی پیش‌نویس‌های نمایشی'")
        source=source.replace('load();fullInventory=inventory;render();','load();fullInventory=inventory;loadCards();render();')
        source=source.replace('پیش‌نمایش محلی · مشخصات تجهیزات و استانداردهای بدون رمز ذخیره می‌شوند؛ رمز و متن کانفیگ ذخیره یا ارسال نمی‌شوند.','نسخه مرکزی · مشخصات و استانداردها روی سرور ثبت می‌شوند؛ بررسی و رفع خطای پورت‌ها در ابزارها با SSH واقعی انجام می‌شود؛ پیکربندی و تطبیق کانفیگ همچنان آفلاین/نمایشی‌اند.')
        a=source.index('  async function runCheck(){');b=source.index('  function render(){',a)
        source=source[:a]+'''  function deviceView(main){
    const {node}=selected();main.append(heading(node.name,node.host),button('ویرایش مشخصات نود',()=>editNode(node)));
    FamEquipmentLive.mount(main,node.id);
  }
'''+source[b:]
        source=source.replace('configuration.suspend();equipmentTools.suspend();root.replaceChildren();','FamEquipmentLive.suspend();configuration.suspend();equipmentTools.suspend();root.replaceChildren();')
    else:
        a=source.index('  const errLabel=');b=source.index('  function draw(){',a)
        source=source[:a]+'''  function closeRepair(){FamEquipmentLive.suspend();}
  function invalidateErr(){FamEquipmentLive.invalidate();}
'''+source[b:]
        source=source.replace("mode='excel'","mode='errdisabled'")
        source=source.replace("['errdisabled','بررسی Err-disabled']","['errdisabled','بررسی و رفع خطای پورت‌ها']")
        source=source.replace("[['excel','ورود و خروج اکسل'],['standards','استانداردها و چک‌لیست'],['errdisabled','بررسی و رفع خطای پورت‌ها']]", "[['errdisabled','بررسی و رفع خطای پورت‌ها'],['excel','ورود و خروج اکسل'],['standards','استانداردها و چک‌لیست']]")
        source=source.replace('else errdisabledUI(content);','else FamEquipmentLive.mount(content);')
        marker='  return Object.freeze({mount,suspend,clear,exportInventory});'
        source=source.replace(marker,"  window.addEventListener('storage',event=>{if(event.key===KEY){try{standards=T.validateStandards(JSON.parse(FamEquipmentServer.storage.getItem(KEY)||'{\"version\":1,\"items\":[]}'));standardIssue='';draft=null;auditResult=null;}catch(e){standardIssue='استانداردهای سرور معتبر نیستند؛ ویرایش غیرفعال است.';}}});\n"+marker)
    s,n=re.subn(r'<script id="fam-'+module+r'-js">.*?</script>',lambda _: '<script id="fam-'+module+'-js">\n'+source+'</script>',s,flags=re.S);assert n==1
# Facade must exist before the equipment controllers initialise on DOMContentLoaded.
s=s.replace('<script id="fam-equipment-local-preview-js">','<script id="fam-equipment-server-store-js">\n'+(root/'src/equipment-server-store.js').read_text()+'</script>\n<script id="fam-equipment-local-preview-js">',1)
live=(root/'src/equipment-live-server.js').read_text()
live=live.replace(' let pane=null,'," let manualIP='',manualTargets=[],descriptionBusy=false,descriptions=[];\n let pane=null,",1)
needle="return d.nodes.filter(n=>d.catalog.types.some(t=>t.id===n.typeId&&t.kind==='switch'));"
assert needle in live
live=live.replace(needle,"return [...d.nodes.filter(n=>d.catalog.types.some(t=>t.id===n.typeId&&t.kind==='switch')),...( ['types','models','regions','siteKinds','sites'].every(k=>Access.current()?.equipmentScope?.[k]?.includes('*'))?manualTargets.filter(n=>!d.nodes.some(x=>x.host===n.host)):[])];",1)
live=live.replace('function invalidate(){epoch++;','function invalidate(){descriptions=[];epoch++;',1)
live=live.replace('pane.append(fieldset);if(busy)','pane.append(fieldset);manualControls(pane);if(busy)',1)
live=live.replace('pane.append(out);report();',"pane.append(out);const cli=el('section');cli.id='eq-live-descriptions';pane.append(cli);report();",1)
live=live.replace('if(!root)return;root.replaceChildren();','if(!root)return;descriptionsView();root.replaceChildren();',1)
live=live.replace("if(busy)return;try{allowed('equipment-scan');","if(busy||descriptionBusy)return;try{allowed('equipment-scan');",1)
needle_scan='break;}report();}}\n   finally';assert needle_scan in live
live=live.replace(needle_scan,"break;}report();}if(token===epoch)await descriptionsRead(results.filter(r=>r.state==='checked').map(r=>r.node),token);}\n   finally",1)
live=live.replace('function clear(){invalidate();',"function clear(){manualIP='';manualTargets=[];descriptionBusy=false;invalidate();",1)
live=live.replace(' function draw(){',(root/'src/equipment-server-port-additions.js').read_text()+'\n function draw(){',1)
s=s.replace('\n</body>','\n<script id="fam-equipment-management-js">\n'+live+'</script>\n</body>',1)
a=s.index('function clearLog() {');b=s.index('/* ---------- results',a)
s=s[:a]+"""function clearLog(){
 if(!Access.require('clear-history'))return false;
 ConfirmBox('پاک‌سازی تاریخچهٔ مرکزی','فهرست تاریخچه برای همه پاک شود؟ داده‌ها و نسخه‌های داخلی لازم برای بازگشت تغییر نمی‌کنند.',async()=>{
  if(!Access.require('clear-history'))return;
  try{await FamShared.api('history/clear',{confirm:true});await FamShared.load();renderLogView();Toast('فهرست تاریخچه پاک شد.','ok');}catch(e){Toast(e.message,'warn');}
 });
}

"""+s[b:]

a=(root/'src/shared-access.js').read_text()
assert 'localStorage' not in a and 'hashPassword' not in a
assert 'const Access' in a and 'FamShared.api' in a
s,n=re.subn(r'<script id="fam-local-access-js">.*?</script>',lambda _: '<script id="fam-local-access-js">\n'+a+'</script>',s,flags=re.S);assert n==1
start=s.index('  // restore saved session (previously imported data), if any')
end=s.index('  // stash the remembered view NOW',start)
s=s[:start]+'  let restored = false;\n'+s[end:]
s=s.replace('const uiSavedBoot = (typeof loadUIState === "function") ? loadUIState() : null;', 'let uiSavedBoot = null;',1)
s=s.replace('  await Access.start();','  await Access.start();\n  await FamShared.load();\n  restored = true;uiSavedBoot=loadUIState();restorePanelDraft();',1)
s=s.replace('    Access.renderViewer();\n    return;', '    Access.renderViewer();\n    FamShared.ready();\n    return;',1)
needle='  permissionObserver.observe(document.getElementById("layout"), {childList:true,subtree:true});'
assert s.count(needle)==1;s=s.replace(needle,needle+'\n  FamShared.ready();',1)
s=s.replace('"Mohsen_FINAL_v5_state_v2"','"fam.shared.ui.v1"')
s=s.replace('localStorage.getItem(LS_KEY_UI)',"localStorage.getItem(LS_KEY_UI+':'+(Access.current()?.id||'anonymous'))")
s=s.replace('localStorage.setItem(LS_KEY_UI,',"localStorage.setItem(LS_KEY_UI+':'+(Access.current()?.id||'anonymous'),")
s=s.replace(' — Passwords and sheet locks in this app only SIMULATE the Excel workbook behavior. They are NOT real security. All data lives in the browser; anyone with the file/data can read it.',' — Central mode: the server enforces authentication, permissions and versioned writes; HTTPS and private database storage are required.')
s=s.replace('data-default-theme="original"','data-default-theme="original" data-fam-variant="shared"',1)
s=s.replace('<title>','<title>فام مرکزی — ',1)
s=re.sub(r'<meta name="fam-release" content="[^"]*">','<meta name="fam-release" content="FAM-SERVER-MANUAL-IP-DES-20261017">',s,count=1)
s=s.replace('\n</head>','\n<style id="fam-shared-css">\n'+(root/'src/shared-sync.css').read_text()+'\n</style>\n</head>',1)
s=s.replace('\n</body>','\n<script id="fam-shared-js">\n'+(root/'src/shared-sync.js').read_text()+'\n</script>\n</body>',1)
p=root/'server/private_ui/FAM.html';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
print('Built protected central two-theme client:',p.relative_to(root))
