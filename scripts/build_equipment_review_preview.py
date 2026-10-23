"""Portable, synthetic UI review: actual components; no SSH, backend or secrets."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
css='''
:root{--bg-1:#f4f6fa;--glass:#fff;--glass-2:#f6f8fb;--stroke:#e0e6ef;--txt-0:#22344b;--txt-1:#63748b;--cyan:#315edb;--accent:#315edb;--bg:#fff;--text:#22344b;--muted:#63748b}
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#22344b;font:14px/1.9 Tahoma,Arial,sans-serif}button,input{font:inherit}button{cursor:pointer}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid #e0e6ef;border-radius:8px;padding:9px 14px;background:#fff;color:#22344b}.btn-primary{background:#315edb;border-color:#315edb;color:white}.btn:disabled{opacity:.5;cursor:not-allowed}.inp{background:#fff;border:1px solid #dce3ed;border-radius:8px;padding:11px;color:#22344b;min-width:0}.eq-field{display:flex;flex-direction:column;gap:7px}.eq-muted{color:#63748b}.eq-error{color:#b84444}.eq-notice{font-size:12px;line-height:1.9;padding:12px;border-radius:8px;background:#f2f5fa}.preview-warning{background:#fff5d8;color:#715419;padding:13px 20px;text-align:center;font-size:12px}main{max-width:1200px;margin:28px auto;padding:0 20px}.preview-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:20px}.preview-heading h1{font-size:24px;margin:0}.preview-heading p{font-size:12px;color:#63748b;margin:5px 0}#equipment-workspace{border:0!important;box-shadow:none!important;overflow:visible!important}#mount{padding-top:10px}.preview-small{font-size:11px;margin:20px 0;color:#63748b}
'''
mock='''
window.Access={can:()=>true,current:()=>({id:'preview',equipmentScope:Object.fromEntries(['types','models','regions','siteKinds','sites'].map(k=>[k,['*']]))}),equipmentView:v=>v};
const previewCatalog=FamEquipmentInventory.defaults().catalog;
previewCatalog.regions[0].name='منطقه ۱ · خراسان';
previewCatalog.sites.push({id:'mashhad',name:'مشهد',siteKindId:'kind-branch'},{id:'neyshabur',name:'نیشابور',siteKindId:'kind-branch'},{id:'tehran-site',name:'تهران',siteKindId:'kind-branch'});
const previewNodes=[['235','سوئیچ ۲۳۵ · شعبه مشهد','type-switch','region-1','kind-branch','mashhad'],['236','سوئیچ ۲۳۶ · شعبه نیشابور','type-switch','region-1','kind-branch','neyshabur'],['237','سوئیچ ۲۳۷ · مشهد مرکزی','type-switch','region-1','kind-branch','mashhad'],['108','سوئیچ ۱۰۸ · تهران','type-switch','region-2','kind-branch','tehran-site'],['301','سوئیچ منطقه ۳','type-switch','region-3','kind-branch',null],['401','سوئیچ منطقه ۴','type-switch','region-4','kind-branch',null],['s68','سوئیچ ساختمان ۶۸ شرقی','type-switch','region-1','kind-building','building-1'],['srezvan','سوئیچ ساختمان رضوان','type-switch','region-1','kind-building','building-0'],['r235','روتر شعبه مشهد','type-router','region-1','kind-branch','mashhad'],['r68','روتر ساختمان ۶۸ شرقی','type-router','region-1','kind-building','building-1']].map(([id,name,typeId,regionId,siteKindId,siteId],i)=>({id,name,typeId,regionId,siteKindId,siteId,host:'100.100.1.'+(i+1),modelId:typeId==='type-router'?'model-1841':'model-2960'}));
window.FamEquipmentServer={inventory:()=>({version:3,catalog:previewCatalog,nodes:previewNodes}),blocked:()=>false};
window.FamShared={api:async()=>{throw Error('این فایل فقط پیش‌نمایش چیدمان است؛ هیچ اتصال یا عملیات واقعی روی تجهیزات انجام نمی‌شود.');}};
'''
boot='''
FamEquipmentLive.mount(document.getElementById('mount'));
document.getElementById('preview-account').onclick=()=>{void FamEquipmentSession.request({force:true});};
document.getElementById('preview-exit').onclick=()=>{FamEquipmentSession.clear();FamEquipmentLive.clear();};
document.addEventListener('fam-equipment-session-changed',()=>{document.getElementById('preview-account').textContent=FamEquipmentSession.ready()?'حساب نمایشی · '+FamEquipmentSession.username():'ورود حساب نمایشی';});
// Demo values only: no real password or network request.
void FamEquipmentSession.request();document.getElementById('eq-session-username').value='demo';document.getElementById('eq-session-password').value='demo';document.getElementById('eq-session-submit').click();
document.getElementById('eq-live-search').click();document.querySelector('.eq-tree-row[data-device-kind="switch"] .eq-tree-title')?.click();
'''
parts=['<!doctype html><html lang="fa" dir="rtl" data-ui-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>پیش‌نمایش طراحی بررسی تجهیزات</title><style>',css,(root/'src/equipment-workspace.css').read_text(),(root/'src/equipment-review.css').read_text(),'</style></head><body><aside class="preview-warning">فقط پیش‌نمایش طراحی · داده‌ها آزمایشی‌اند · اتصال به تجهیزات غیرفعال است · رمز واقعی وارد نکنید</aside><main><header class="preview-heading"><div><h1>بررسی تجهیزات</h1><p>IP یا نام محل را بنویسید؛ مجموعه یا زیرمجموعهٔ دلخواه را از درخت تجهیزات تیک بزنید.</p></div><div><button class="btn" id="preview-account">حساب نمایشی</button> <button class="btn" id="preview-exit">پایان نشست نمایشی</button></div></header><div id="equipment-workspace"><div id="mount"></div></div><p class="preview-small">برای امتحان، «۲۳۵» یا «خراسان» را بنویسید. این فایل بدون اینترنت و بدون لینک موقت باز می‌شود. حساب و انتخاب‌ها فقط در حافظه‌اند.</p></main>']
for text in [(root/'src/equipment-inventory.js').read_text(),mock,*[(root/'src'/p).read_text() for p in ['equipment-session.js','equipment-switch-picker.js','equipment-live-server.js']],boot]:
 parts+=['<script>',text.replace('</script','<\\/script'),'</script>']
parts+=['</body></html>']
out=root/'previews/Equipment-Review-Design.html';out.write_text('\n'.join(parts));print(out.name,out.stat().st_size,'bytes; no external resources')
