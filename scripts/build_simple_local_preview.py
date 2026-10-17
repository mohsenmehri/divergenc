"""Build an isolated LOCAL UI preview without touching stable LOCAL/SERVER.
Uses the same simple port workflow with an explicit, network-free demo adapter.
"""
from pathlib import Path
import hashlib
import re
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'FAM.html').read_text()
for module in ('equipment-local-preview','equipment-tools'):
    source=(ROOT/f'src/{module}.js').read_text()
    if module=='equipment-local-preview':
        source=source.replace("if(!credentials){gate();return;}","if(!credentials)credentials={userId:Access.current()?.id,username:'local-preview',password:''};")
        source=source.replace("'RADIUS آماده است'","'پیش‌نمایش LOCAL'").replace("'معتبر تا خروج از حساب FAM · فقط در حافظه'","'بدون اتصال SSH و بدون تغییر واقعی پورت'").replace("'تغییر اطلاعات RADIUS'","'بازنشانی پیش‌نمایش'")
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
adapter='''window.FamEquipmentLocalTransport=(()=>{
 let samples=false;
 function inventory(){const raw=localStorage.getItem('fam.equipment.inventory.v3');const data=Access.equipmentView(raw?FamEquipmentInventory.validate(JSON.parse(raw)):FamEquipmentInventory.defaults());
  if(samples){const type=data.catalog.types.find(t=>t.kind==='switch'),model=data.catalog.models.find(m=>m.typeId===type?.id),region=data.catalog.regions[0],site=data.catalog.sites[0],kind=data.catalog.siteKinds.find(k=>k.id===site?.siteKindId);
   if(type&&model&&region&&kind&&site)for(const i of [1,2])data.nodes.push({id:'local-sample-'+i,name:'سوئیچ نمونه '+i+' (ساختگی)',host:'10.254.253.'+i,typeId:type.id,modelId:model.id,regionId:region.id,siteKindId:kind.id,siteId:site.id});
  }return data;
 }
 document.addEventListener('fam-access-changed',()=>samples=false);window.addEventListener('pagehide',()=>samples=false);
 return Object.freeze({inventory,blocked:()=>false,addSamples:()=>samples=true,async api(path,value){
  await new Promise(resolve=>setTimeout(resolve,200));
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
(folder/'README_FA.txt').write_text('''پیش‌نمایش LOCAL رابط سادهٔ بررسی پورت‌ها

ZIP را در یک پوشهٔ جدید استخراج و FAM.html یا START-FAM.cmd را باز کنید.
حساب اولیهٔ محلی: admin / 1109. اگر رمز همین مرورگر قبلاً تغییر کرده، رمز قبلی معتبر است.
مدیریت تجهیزات ← ابزارها: انتخاب سوئیچ‌ها ← بررسی نمایشی پورت‌ها ← نمایش نام/IP سوئیچ کنار پورت ← تأیید رفع نمایشی.
برای تست بدون واردکردن تجهیزات، دکمهٔ «۲ سوئیچ نمونه برای تست» را بزنید. سوئیچ‌های نمونه فقط در RAM همان ابزارند و در موجودی ذخیره نمی‌شوند.
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
