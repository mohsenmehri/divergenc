"""Build an isolated LOCAL UI preview without touching stable LOCAL/SERVER.
Uses the same simple port workflow with an explicit, network-free demo adapter.
"""
from pathlib import Path
import hashlib
import re
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'FAM.html').read_text()
html=re.sub(r'<title>.*?</title>','<title>FAM LOCAL — IP دستی و show int des (نمایشی)</title>',html,count=1)
for module in ('equipment-local-preview','equipment-tools'):
    source=(ROOT/f'src/{module}.js').read_text()
    if module=='equipment-local-preview':
        source=source.replace("if(!credentials){gate();return;}","if(!credentials)credentials={userId:Access.current()?.id,username:'local-preview',password:''};")
        source=source.replace("'RADIUS آماده است'","'LOCAL · IP دستی + show int des'").replace("'معتبر تا خروج از حساب FAM · فقط در حافظه'","'بدون اتصال SSH و بدون تغییر واقعی پورت'").replace("'تغییر اطلاعات RADIUS'","'بازنشانی پیش‌نمایش'")
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
        source=source.replace("[['excel','ورود و خروج اکسل'],['standards','استانداردها و چک‌لیست'],['errdisabled','بررسی Err-disabled']]", "[['errdisabled','بررسی و رفع خطای پورت‌ها — نمایشی'],['excel','ورود و خروج اکسل'],['standards','استانداردها و چک‌لیست']]")
        source=source.replace('else errdisabledUI(content);','else FamEquipmentLive.mount(content);')
    html,n=re.subn(r'<script id="fam-'+module+r'-js">.*?</script>',lambda _:f'<script id="fam-{module}-js">\n'+source+'</script>',html,flags=re.S);assert n==1
live=(ROOT/'src/equipment-live-server.js').read_text()
a=live.index('  const account=');b=live.index('  const run=',a);live=live[:a]+live[b:]
live=live.replace("if(!auth.username.trim()||!auth.password)throw Error('نام کاربری و رمز ورود سوئیچ را وارد کنید.');",'')
live=live.replace('FamEquipmentServer','FamEquipmentLocalTransport').replace('FamShared.api','FamEquipmentLocalTransport.api').replace("'server-ssh'","'local-ui-demo'")
for old,new in [
 ('بررسی و رفع خطای پورت‌ها','بررسی و رفع خطای پورت‌ها — نمایشی LOCAL'),
 ('بررسی پورت‌ها','بررسی نمایشی پورت‌ها'),
 ('بررسی واقعی SSH از سرور FAM؛ اتصال ناموفق هرگز «بدون خطا» گزارش نمی‌شود.','نمونهٔ رابط LOCAL؛ همهٔ پورت‌ها و نتیجه‌ها ساختگی‌اند. هیچ اتصالی برقرار نشده است.'),
 ('نتیجه فقط از اتصال واقعی SSH خوانده می‌شود.','این پیش‌نمایش هیچ اتصال یا بررسی واقعی انجام نمی‌دهد.'),
 ('بررسی‌ها یکی‌یکی از سرور FAM انجام می‌شوند.','تمام بررسی‌ها و رفع‌ها در این صفحه فقط نمایشی‌اند.'),
 ('عملیات واقعی در حال اجراست؛ درخواست خودکار تکرار نمی‌شود.','نمایش مراحل نمونه در حال اجراست؛ هیچ فرمانی ارسال نمی‌شود.'),
 ('در حال اتصال SSH…','در حال نمایش نمونه…'),
 ('Err-disabled یافت شد','Err-disabled نمونه (ساختگی)'),
 ('بررسی موفق؛ پورت Err-disabled یافت نشد.','نمونه بدون پورت خطادار؛ وضعیت واقعی نامشخص است.'),
 ('این عملیات واقعی است: بررسی مجدد همان پورت، shutdown / no shutdown و بررسی نتیجه. هیچ تنظیمی ذخیره نمی‌شود.','این عملیات فقط نمایشی است؛ هیچ اتصال، فرمان، shutdown / no shutdown یا تغییر واقعی انجام نمی‌شود.'),
 ('رفع شد؛ بررسی پس از عملیات نشان داد این پورت دیگر Err-disabled نیست.','رفع نمایشی انجام شد؛ وضعیت واقعی پورت بررسی یا تغییر داده نشده است.'),
 ('تأیید و رفع خطا','تأیید و رفع نمایشی خطا'),
 ('تأیید و رفع پورت‌های انتخاب‌شده','تأیید و رفع نمایشی پورت‌های انتخاب‌شده')]:live=live.replace(old,new)
live=live.replace("pane.append(title,", "pane.append(title,el('p','eq-notice warning','فقط بررسی ظاهر و مراحل: این فایل به سوئیچ وصل نمی‌شود و نتیجهٔ واقعی نشان نمی‌دهد.'),button('۲ سوئیچ نمونه برای تست (فقط در حافظه)',()=>{FamEquipmentLocalTransport.addSamples();invalidate();draw();},'eq-local-samples'),",1)
live=re.sub(r'^/\*.*?\*/', '/* LOCAL-only simple workflow preview. All results are synthetic; no network. */',live,count=1,flags=re.S)
# LOCAL-specific controls share the simple scan/review flow; never add a
# transport or pretend that the browser can connect to a physical switch.
live=live.replace(' let pane=null,'," let manualIP='',descriptionBusy=false,descriptions=[];\n let pane=null,",1)
live=live.replace('function invalidate(){epoch++;',"function invalidate(){descriptions=[];epoch++;",1)
live=live.replace("const fieldset=el('fieldset');fieldset.disabled=busy;", "manualControls(pane);const fieldset=el('fieldset');fieldset.disabled=busy;",1)
live=live.replace('pane.append(out);report();',"pane.append(out);const cli=el('section');cli.id='eq-local-descriptions';pane.append(cli);report();",1)
live=live.replace("if(!root)return;root.replaceChildren();", "if(!root)return;descriptionsView();root.replaceChildren();",1)
live=live.replace("if(busy)return;try{allowed('equipment-scan');", "if(busy||descriptionBusy)return;try{allowed('equipment-scan');",1)
needle_scan="break;}report();}}\n   finally"
assert needle_scan in live
live=live.replace(needle_scan,"break;}report();}if(token===epoch)await descriptionsRead(results.filter(r=>r.state==='checked').map(r=>r.node),token);}\n   finally",1)
live=live.replace('function clear(){invalidate();',"function clear(){manualIP='';descriptionBusy=false;invalidate();",1)
live=live.replace(' function draw(){',(ROOT/'src/equipment-local-preview-additions.js').read_text()+'\n function draw(){',1)

adapter='''window.FamEquipmentLocalTransport=(()=>{
 let samples=false,manual=[];
 function canonical(){const raw=localStorage.getItem('fam.equipment.inventory.v3');return raw?FamEquipmentInventory.validate(JSON.parse(raw)):FamEquipmentInventory.defaults();}
 function inventory(){const data=Access.equipmentView(canonical());data.nodes.push(...manual.filter(n=>Object.entries({types:'typeId',models:'modelId',regions:'regionId',siteKinds:'siteKindId',sites:'siteId'}).every(([k,f])=>data.catalog[k].some(x=>x.id===n[f]))));
  if(samples){const type=data.catalog.types.find(t=>t.kind==='switch'),model=data.catalog.models.find(m=>m.typeId===type?.id),region=data.catalog.regions[0],site=data.catalog.sites[0],kind=data.catalog.siteKinds.find(k=>k.id===site?.siteKindId);
   if(type&&model&&region&&kind&&site)for(const i of [1,2])data.nodes.push({id:'local-sample-'+i,name:'سوئیچ نمونه '+i+' (ساختگی)',host:'10.254.253.'+i,typeId:type.id,modelId:model.id,regionId:region.id,siteKindId:kind.id,siteId:site.id});
  }return data;
 }
 function addManual(host){
  if(!FamEquipmentInventory.privateIP(host))throw Error('فقط IPv4 خصوصی معتبر وارد کنید؛ مثال 10.2.35.2.');
  const data=inventory(),existing=data.nodes.find(n=>n.host===host);
  if(existing){if(!data.catalog.types.some(t=>t.id===existing.typeId&&t.kind==='switch'))throw Error('این IP در موجودی متعلق به سوئیچ نیست.');return existing.id;}
  if(canonical().nodes.some(n=>n.host===host)||!['types','models','regions','siteKinds','sites'].every(k=>Access.current()?.equipmentScope?.[k]?.includes('*')))throw Error('IP در موجودی مجاز شما نیست؛ مدیر باید آن را با دسته‌های مجاز تعریف کند.');
  const type=data.catalog.types.find(t=>t.kind==='switch'),model=data.catalog.models.find(m=>m.typeId===type?.id),region=data.catalog.regions[0],site=data.catalog.sites[0],kind=data.catalog.siteKinds.find(k=>k.id===site?.siteKindId);
  if(!type||!model||!region||!site||!kind)throw Error('برای نمونهٔ IP دستی، دسته‌های نوع/مدل/منطقه/محل مجاز باید موجود باشند.');
  if(manual.length>=5)manual.shift();const node={id:'manual-'+crypto.randomUUID(),name:'IP دستی (نمایشی) '+host,host,typeId:type.id,modelId:model.id,regionId:region.id,siteKindId:kind.id,siteId:site.id};manual.push(node);return node.id;
 }
 const reset=()=>{samples=false;manual=[];};document.addEventListener('fam-access-changed',reset);window.addEventListener('pagehide',reset);
 return Object.freeze({inventory,addManual,blocked:()=>false,addSamples:()=>samples=true,async api(path,value){
  await new Promise(resolve=>setTimeout(resolve,200));
  if(!inventory().nodes.some(n=>n.host===value.host))throw Error('مقصد مجاز پیدا نشد.');
  if(path==='equipment/descriptions')return {host:value.host,source:'local-ui-demo',output:'Interface                      Status         Protocol Description\\nGi0/1                          up             up       SAMPLE uplink\\nGi0/7                          down           down     SAMPLE err-disabled port\\nGi0/8                          admin down     down     SAMPLE spare\\n'};
  if(path==='equipment/check')return {host:value.host,source:'local-ui-demo',checkedAt:Date.now(),errDisabledPorts:[{interface:'Gi0/7',description:'پورت نمونه؛ غیرواقعی'}],recoveryTickets:{'Gi0/7':'local-preview-only'}};
  if(path==='equipment/recover')return {host:value.host,interface:value.interface,recovery:'recovered'};
  throw Error('در این پیش‌نمایش هیچ API یا اتصال شبکه‌ای وجود ندارد.');
 }});
})();
'''
html=html.replace('\n</body>','\n<script id="fam-equipment-simple-local-js">\n'+adapter+live+'</script>\n</body>',1)
folder=ROOT/'patches/fam-simple-ports-local-preview';folder.mkdir(parents=True,exist_ok=True)
(folder/'FAM.html').write_text(html)
(folder/'START-FAM.cmd').write_bytes((ROOT/'patches/fam-custom-access-local/START-FAM.cmd').read_bytes())
(folder/'README_FA.txt').write_text('''پیش‌نمایش LOCAL — IP دستی و خروجی show int des

ZIP را در یک پوشهٔ جدید استخراج و FAM.html یا START-FAM.cmd را باز کنید.
حساب اولیهٔ محلی: admin / 1109. اگر رمز همین مرورگر قبلاً تغییر کرده، رمز قبلی معتبر است.
مدیریت تجهیزات ← ابزارها: انتخاب سوئیچ‌ها ← بررسی نمایشی پورت‌ها ← نمایش نام/IP سوئیچ کنار پورت ← تأیید رفع نمایشی.
برای تست بدون واردکردن تجهیزات، دکمهٔ «۲ سوئیچ نمونه برای تست» را بزنید. سوئیچ‌های نمونه فقط در RAM همان ابزارند و در موجودی ذخیره نمی‌شوند.
بخش انتخاب/اعمال سناریو کاملاً از رابط حذف شده است. در کادر «IP دستی» یک IPv4 خصوصی وارد و «بررسی IP دستی — نمایشی» را بزنید. مقصد دستی فقط در RAM است و ذخیره نمی‌شود؛ رفع نمونه فقط بعد از انتخاب پورت و تأیید جدا انجام می‌شود.
پس از بررسی، خروجی نمونه show int des زیر جدول نمایش داده می‌شود؛ دکمهٔ مستقل نمایش خروجی هم وجود دارد. سطرها و فاصله‌ها در کادر متنی حفظ می‌شوند. این خروجی ساختگی است و از سوئیچ شما دریافت نشده است.
فرم اضافی RADIUS و انتخاب سناریوهای پیچیده حذف شده؛ رمز واقعی لازم نیست و نباید وارد کنید.
تمام پورت‌ها و نتیجه‌های این نسخه ساختگی و با برچسب نمایشی‌اند. این فایل نه به سوئیچ وصل می‌شود و نه پورت واقعی را بررسی یا رفع می‌کند.
موجودی و حساب‌های LOCAL قبلی در همین origin/browser ممکن است مشترک باشند؛ برای بررسی کاملاً جدا از یک پروفایل مرورگر جدا استفاده کنید. اضافه‌کردن نمونه‌ها موجودی قبلی را تغییر نمی‌دهد.
این بستهٔ مستقل، فایل‌ها و انتشار پایدار LOCAL یا SERVER را جایگزین نمی‌کند.
''')
(folder/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256((folder/n).read_bytes()).hexdigest()+'  '+n+'\n' for n in ['FAM.html','START-FAM.cmd','README_FA.txt']))
out=ROOT/'releases/FAM-Simple-Ports-LOCAL-Preview.zip'
with ZipFile(out,'w',ZIP_DEFLATED,compresslevel=9) as archive:
 for p in sorted(folder.iterdir()):
  info=ZipInfo(p.name,(2026,10,17,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,p.read_bytes())
(out.with_suffix('.zip.sha256')).write_text(hashlib.sha256(out.read_bytes()).hexdigest()+'  '+out.name+'\n')
print(out.relative_to(ROOT),out.stat().st_size,hashlib.sha256(out.read_bytes()).hexdigest())
