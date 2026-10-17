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
        source=source.replace("'RADIUS آماده است'","'نشست کاربری سرور'").replace("'معتبر تا خروج از حساب FAM · فقط در حافظه'","'تجهیزات مرکزی · ابزارهای بررسی و پیکربندی نمایشی'").replace("'تغییر اطلاعات RADIUS'","'بازنشانی پیش‌نویس‌های نمایشی'")
        source=source.replace('load();fullInventory=inventory;render();','load();fullInventory=inventory;loadCards();render();')
        source=source.replace('پیش‌نمایش محلی · مشخصات تجهیزات و استانداردهای بدون رمز ذخیره می‌شوند؛ رمز و متن کانفیگ ذخیره یا ارسال نمی‌شوند.','نسخه مرکزی · مشخصات و استانداردها روی سرور ثبت می‌شوند؛ بررسی/رفع گروهی و پیکربندی همچنان نمایشی‌اند. مسیر SSH واقعی در بخش جداگانه است.')
    else:
        marker='  return Object.freeze({mount,suspend,clear,exportInventory});'
        source=source.replace(marker,"  window.addEventListener('storage',event=>{if(event.key===KEY){try{standards=T.validateStandards(JSON.parse(FamEquipmentServer.storage.getItem(KEY)||'{\"version\":1,\"items\":[]}'));standardIssue='';draft=null;auditResult=null;}catch(e){standardIssue='استانداردهای سرور معتبر نیستند؛ ویرایش غیرفعال است.';}}});\n"+marker)
    s,n=re.subn(r'<script id="fam-'+module+r'-js">.*?</script>',lambda _: '<script id="fam-'+module+'-js">\n'+source+'</script>',s,flags=re.S);assert n==1
# Facade must exist before the equipment controllers initialise on DOMContentLoaded.
s=s.replace('<script id="fam-equipment-local-preview-js">','<script id="fam-equipment-server-store-js">\n'+(root/'src/equipment-server-store.js').read_text()+'</script>\n<script id="fam-equipment-local-preview-js">',1)
s=s.replace('\n</body>','\n<script id="fam-equipment-management-js">\n'+(root/'src/equipment-live-server.js').read_text()+'</script>\n</body>',1)
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
s=s.replace('\n</head>','\n<style id="fam-shared-css">\n'+(root/'src/shared-sync.css').read_text()+'\n</style>\n</head>',1)
s=s.replace('\n</body>','\n<script id="fam-shared-js">\n'+(root/'src/shared-sync.js').read_text()+'\n</script>\n</body>',1)
p=root/'server/private_ui/FAM.html';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
print('Built protected central two-theme client:',p.relative_to(root))
