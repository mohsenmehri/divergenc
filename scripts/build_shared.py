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
# One shared equipment UI, with a central storage adapter and canonical SSH UI.
# No text-rewrite fork of the workspace or nested LOCAL scenario controller.
s=s.replace('<script id="fam-equipment-workspace-js">','<script id="fam-equipment-server-store-js">\n'+(root/'src/equipment-server-store.js').read_text()+'</script>\n<script id="fam-equipment-workspace-js">',1)
s=s.replace('\n</body>','\n<script id="fam-equipment-management-js">\n'+(root/'src/equipment-live-server.js').read_text()+'\n</script>\n</body>',1)
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
s=re.sub(r'<meta name="fam-release" content="[^"]*">','<meta name="fam-release" content="FAM-EQUIPMENT-V2-SERVER-FIX-20261017">',s,count=1)
s=s.replace('<head>', '<head>\n<meta name="fam-client-mac-replacement-release" content="FAM-CLIENT-MAC-REPLACEMENT-20261018">\n<meta name="fam-client-diagnosis-release" content="FAM-CLIENT-DIAGNOSIS-20261018">',1)
s=s.replace('\n</head>','\n<style id="fam-shared-css">\n'+(root/'src/shared-sync.css').read_text()+'\n</style>\n</head>',1)
s=s.replace('\n</body>','\n<script id="fam-shared-js">\n'+(root/'src/shared-sync.js').read_text()+'\n</script>\n</body>',1)
p=root/'server/private_ui/FAM.html';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
print('Built protected central two-theme client:',p.relative_to(root))

# Minimal IIS login keeps its strict script/style policy; only the existing
# trusted inline PNG is allowed, with no extra deployed file or network request.
logo=re.search(r'<div class="brand-logo">\s*(<img[^>]+>)',s).group(1)
logo=re.sub(r'alt="[^"]*"','alt="لوگوی فام"',logo)
login=root/'server/www/login.html'
text=login.read_text()
identity='<figure class="login-brand">'+logo+'<figcaption>تجارت الکترونیک و فناوری اطلاعات ملل (فام)</figcaption></figure>'
text,n=re.subn(r'<div class="mark"[^>]*>.*?</div>|<figure class="login-brand">.*?</figure>',lambda _:identity,text,count=1,flags=re.S);assert n==1
text=re.sub(r'\n    <p class="subtitle">.*?</p>','',text)
if 'img-src' not in text:text=text.replace("script-src 'self';", "img-src 'self' data:; script-src 'self';")
login.write_text(text)
