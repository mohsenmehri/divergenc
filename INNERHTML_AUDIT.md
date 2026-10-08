# ممیزی innerHTML — فهرست کامل و وضعیت صادقانه

**ادعای دقیق:** مسیرهای پرخطر (داده از import / ورودی کاربر / localStorage) escape شده‌اند
و **حفره XSS معناداری باقی نمانده**؛ اما «مشکل innerHTML تموم شده» ادعای دقیقی نیست.
بازسازی کامل به DOM API (`createElement`/`textContent`) **مرحله بعدی** است.

## وضعیت کلی

| مورد | تعداد | وضعیت |
|---|---|---|
| کل استفاده‌های innerHTML | 31 | ممیزی شده در جدول پایین |
| درون‌ریزی داده خام (بدون escape) | **0** | همه escape یا قالب ثابت |
| inline event handler (onclick=…) | **0** | حذف کامل — event delegation + `data-act` |
| بازسازی به DOM API خالص | 0 → مرحله بعد | refactor تدریجی |

## نکات معماری ایمن فعلی

- `escapeHtml` (محتوا، تبدیل `\n` به `<br>`)، `escapeHtmlAttr` (خصوصیت، شامل `&#39;`)، `encJs` (رشته JS درون handler — دیگر استفاده نمی‌شود چون handler درون‌خطی حذف شد).
- داده‌های پویا (نام شیت، مقدار سلول، نام فایل) **فقط** از مسیر escape به HTML می‌رسند.
- handler ها: `data-act` + `ACTIONS[...]` در `ui.js` — هیچ رشته اجرایی از داده ساخته نمی‌شود.
- CSP صفحه: `script-src-attr 'none'` — حتی اگر handler درون‌خطی‌ای از قلم بیفتد، مرورگر آن را اجرا نمی‌کند.
- `ModalBox`، `WizardAddForm` و navigator `opts.html` فقط قالب‌های داخلی با بخش‌های escape‌شده می‌گیرند.

## فهرست کامل (31 مورد)

| # | فایل | خط | طبقه‌بندی | کد |
|---|---|---|---|---|
| 1 | `core.js` | 200 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `box.innerHTML = `` |
| 2 | `core.js` | 204 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `ov.innerHTML = "";` |
| 3 | `core.js` | 210 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `ov.classList.remove("show"); ov.innerHTML = ""; resolve(id);` |
| 4 | `core.js` | 266 | ✅ SAFE-escaped — داده escape شده | `t.innerHTML = escapeHtml(msg).replace(/\n/g, "<br>");` |
| 5 | `core.js` | 543 | ✅ SAFE-escaped — سلول‌های داده با escapeHtml | `if (!sh) { body.innerHTML = '<div class="empty-state">شیت یافت نشد.</div>'; return; }` |
| 6 | `core.js` | 567 | ✅ SAFE-escaped — سلول‌های داده با escapeHtml | `body.innerHTML = html;` |
| 7 | `core.js` | 632 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `if (!sh // sh.rows.length <= 1) { body.innerHTML = '<div class="empty-state">لاگی ثبت نشده است.</div` |
| 8 | `core.js` | 655 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `body.innerHTML = html;` |
| 9 | `core.js` | 671 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `body.innerHTML = '<div class="empty-state">هنوز نتیجه‌ای ثبت نشده است — از کنترل پنل جستجو انجام دهی` |
| 10 | `core.js` | 700 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `body.innerHTML = html;` |
| 11 | `macros.js` | 378 | ✅ SAFE — قالب ثابت (بدون داده) | `box.innerHTML = `` |
| 12 | `macros.js` | 390 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `ov.innerHTML = ""; ov.appendChild(box); ov.classList.add("show");` |
| 13 | `macros.js` | 391 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `const done = v => { ov.classList.remove("show"); ov.innerHTML = ""; resolve(v); };` |
| 14 | `macros.js` | 507 | ✅ SAFE — قالب ثابت (بدون داده) | `box.innerHTML = `` |
| 15 | `macros.js` | 514 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `ov.innerHTML = ""; ov.appendChild(box); ov.classList.add("show");` |
| 16 | `macros.js` | 515 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `const done = v => { ov.classList.remove("show"); ov.innerHTML = ""; resolve(v); };` |
| 17 | `ui.js` | 128 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `sel.innerHTML = "";` |
| 18 | `ui.js` | 192 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `document.getElementById("modal-overlay").innerHTML = "";` |
| 19 | `ui.js` | 200 | ✅ SAFE — پاک‌سازی (مقدار ثابت) | `document.getElementById("modal-overlay").innerHTML = "";` |
| 20 | `ui.js` | 1012 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `body.innerHTML = html;` |
| 21 | `ui.js` | 1048 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `kpis.innerHTML = kpiDefs.map(k => `` |
| 22 | `ui.js` | 1090 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = `` |
| 23 | `ui.js` | 1097 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `legend.innerHTML = cats.map((c, i) => `` |
| 24 | `ui.js` | 1106 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = top.map(t => `` |
| 25 | `ui.js` | 1120 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = '<div class="empty-state" style="padding:22px">هنوز رویدادی ثبت نشده است.</div>';` |
| 26 | `ui.js` | 1123 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = rows.slice(-9).reverse().map(r => `` |
| 27 | `ui.js` | 1396 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = emptyStateHtml();` |
| 28 | `ui.js` | 1400 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = cats.map(c => {` |
| 29 | `ui.js` | 1424 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = cats.map(c => {` |
| 30 | `ui.js` | 1458 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = emptyStateHtml("هیچ شیت داده‌ای در کار نیست — ابتدا فایل داده خود را وارد کنید.");` |
| 31 | `ui.js` | 1504 | ✅ SAFE — اعداد/رشته‌های ثابت کد | `host.innerHTML = html // '<div class="empty-state">شیتی در این دسته یافت نشد.</div>';` |

## مسیرهای داده‌محور و روش محافظت

| مسیر داده | رندر | محافظت |
|---|---|---|
| سلول‌های گرید (import/ویرایش) | `renderSheetView` | `escapeHtml` |
| نتایج جستجو | `renderResultsView` | `escapeHtml` + `escapeHtmlAttr` در value |
| لاگ تغییرات | `renderLogView` | `escapeHtml` |
| نام شیت‌ها (کارت/ناوبر/لیست‌ها) | catalog/navigator/fillSelect | `escapeHtml`/`escapeHtmlAttr` یا DOM (`option.textContent`) |
| فرم افزودن رکورد (هدرها از داده) | `_runAddForm` | `escapeHtml`/`escapeHtmlAttr` |
| فید داشبورد / نوارها | `renderFeed`/`renderBars` | `escapeHtml` |
| پیام‌ها و Toast | `ModalBox`/`Toast` | `escapeHtml` |

---
*مرحله بعدی (enterprise): refactor این template ها به DOM API خالص + حذف escape به‌عنوان لایه تنها.*
