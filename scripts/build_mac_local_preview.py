"""LOCAL-only visual review build. Canonical LOCAL and SERVER bytes untouched."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'FAM.html').read_text()
needle='main.append(card);}'
assert html.count(needle)==1
html=html.replace(needle,"main.append(card);FamLocalPortPreview.mount(main,inventory.nodes.filter(n=>find('types',n.typeId)?.kind==='switch'));}")
html=html.replace('<head>','<head>\n<meta name="fam-local-mac-preview" content="FAM-LOCAL-MAC-PREVIEW-20261018">',1)
html=html.replace('<title>','<title>پیش‌نمایش محلی تعویض MAC — ',1)
script=(ROOT/'src/equipment-mac-local-preview.js').read_text()
assert '</script' not in script.lower()
assert html.count('\n</body>')==1
html=html.replace('\n</body>','\n<script id="fam-local-mac-preview-js">\n'+script+'\n</script>\n</body>',1)
name='FAM-Client-MAC-LOCAL-Preview.html'
readme='''پیش‌نمایش LOCAL فرم پورت و تعویض MAC — ۲۰۲۶-۱۰-۱۸

فایل FAM-Client-MAC-LOCAL-Preview.html را استخراج و با Chrome یا Edge باز کنید.
برای فایل تازه و بدون حساب قبلی: نام کاربری admin و رمز 1109؛ این فقط ورود محلی برنامه است، نه رمز تجهیز. حساب‌های موجود مرورگر تغییر نمی‌کنند.
مسیر: ورود → تجهیزات → بررسی پورت‌ها.
سوئیچ‌های ثبت‌شدهٔ مجاز در لیست ظاهر می‌شوند. اگر موجودی خالی است، IP سوئیچ را در کادر «فقط برای پیش‌نمایش» وارد کنید؛ اتصال یا ثبت موجودی انجام نمی‌شود.
کنار هر سوئیچ پورت اختیاری و تیک IP دستی را امتحان کنید و «نمایش مسیر انتخاب‌شده — بدون اجرا» را بزنید.
پورت خالی: شرح مسیر Err-disabled فعلی. پورت ۷: پیش‌نمایش مسیر Fa0/7. تیک دستی: همان IP قبلی و فقط MAC جدید در binding و Inspection.
LOCAL هیچ SSH، خواندن جدول، گرفتن MAC، رفع خطا یا تغییر سوئیچی انجام نمی‌دهد. نتایج ساختگی سالم/موفق تولید نمی‌شوند. رمز واقعی تجهیز وارد نکنید؛ این فرم اصلاً رمز تجهیز نمی‌گیرد.
در پیش‌نمایش، IP واقعی کلاینت از سوئیچ قابل دریافت نیست و مقداری حدس زده نمی‌شود. عملیات واقعی فقط در SERVER با پیش‌بررسی و تأیید جداگانه است. Sticky قبلی خودکار پاک نمی‌شود.
اطلاعات قبلی برنامه حذف/ریست نمی‌شوند. مثل نسخهٔ محلی معمول، پیش از استفادهٔ کاری از داده‌های مرورگر خروجی/بکاپ مستقل بگیرید. انتخاب‌های این فرم و IPهای موقت فقط در RAM هستند و با refresh پاک می‌شوند.
'''
data=html.encode();release=ROOT/'releases';release.mkdir(exist_ok=True)
(release/name).write_bytes(data)
out=release/'FAM-Client-MAC-LOCAL-Preview.zip'
with ZipFile(out,'w',ZIP_DEFLATED,compresslevel=9) as z:
 for filename,body in [(name,data),('README_FA.txt',readme.encode())]:
  info=ZipInfo(filename,(2026,10,18,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,body,compress_type=ZIP_DEFLATED,compresslevel=9)
for file in (out,release/name):
 digest=hashlib.sha256(file.read_bytes()).hexdigest()
 file.with_suffix(file.suffix+'.sha256').write_text(f'{digest}  {file.name}\n')
 print(file.relative_to(ROOT),file.stat().st_size,digest)
