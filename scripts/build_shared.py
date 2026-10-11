"""Generate IIS client from the original two-theme FAM, not a redesigned variant.
Offline FAM.html stays a migration source; server/www/FAM.html NEVER uses local
accounts or local workbook persistence. Generated file is reproducible.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
s=(root/'FAM.html').read_text()
a=(root/'src/local-access.js').read_text()
parts=(root/'src/shared-access-parts.js').read_text()
def fragment(name,next_name):
    return parts.split('// === '+name+' ===\n',1)[1].split('// === '+next_name+' ===',1)[0]
a='/* Central accounts: server sessions and permissions; no local credential store. */\n'+a[a.index('const Access'):a.index("  const KEY=")]+fragment('persistence','start')+a[a.index('  function can('):]
a=a[:a.index('  async function start()')]+fragment('start','password')+a[a.index('  function accountMenu()'):]
a=a[:a.index('  function editOwnPassword()')]+fragment('password','end')+a[a.index('  function manageUsers()'):]
a=a.replace('  function manageUsers(){','''  async function manageUsers(){
    if(!requirePermission('users'))return;
    try{const result=await FamShared.api('users');db={users:result.users};usersRevision=result.revision;}
    catch(e){Toast(e.message,'err');return;}''',1)
a=a.replace('persist(next);','await persist(next);').replace("try{persist({", "try{await persist({")
a=a.replace('establish(changed);', 'establish(db.users.find(u=>u.id===changed.id)||changed);')
a=a.replace("document.documentElement.classList.remove('auth-pending');", "document.documentElement.classList.remove('auth-pending');FamShared.identity(user.revision);",1)
a=a.replace('مدیریت کاربران محلی','مدیریت کاربران سرور')
start=a.index("  window.addEventListener('storage'");end=a.index('  return Object.freeze',start)
a=a[:start]+a[end:]
assert 'localStorage' not in a and 'hashPassword' not in a
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
p=root/'server/www/FAM.html';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
print('Built central two-theme client:',p.relative_to(root))
