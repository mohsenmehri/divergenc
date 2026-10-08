# فهرست معادل‌سازی رفتاری — ماکروهای VBA ⇄ نسخه HTML

این سند تضمین می‌کند هر ماکروی اصلی فایل `Mohsen_FINAL_v5.xlsm` **معادل رفتاری درست**
در نسخه HTML دارد — نه فقط شباهت ظاهری. وضعیت‌ها:

- ✅ **PASSED** — تست خودکار رفتار را تأیید می‌کند (نام تست در پرانتز)
- 🔶 **MANUAL** — معادل پیاده‌سازی شده؛ تأیید رفتاری دستی لازم است

> **لایه دوم اثبات (مرورگر واقعی):** مجموعه Playwright در `src/e2e/smoke.js`
> (۲۴ سناریو در Chromium واقعی) — از جمله اجرای واقعی CSP و باز شدن واقعی
> پنجره فایل. با `cd src/e2e && npm install && npm test` قابل تکرار است.
>
> **نحوه اثبات ادعاها:** نتیجه تست‌ها را نمی‌توان از فایل HTML اثبات کرد. مرجع،
> اجرای `node src/test/test_app.js` در همین repository و خروجی checks در PR است.
> این سند «فهرست پوشش» است نه گزارش تست زنده.

مجموعه تست خودکار: `src/test/test_app.js` — در حال حاضر **105 assertion**، همه سبز
(۱۰۳ ادعای رفتاری + ۲ نگهبان DoD بازسازی DOM API).

> **بازسازی DOM API (فاز ۹):** همه‌ی renderer ها به `el()`/`sEl()`/`textContent` تبدیل شدند؛
> صفر `innerHTML` در سورس‌های برنامه. دو نگهبان DoD (`dom-api: zero innerHTML-family calls…`
> و `dom-api: no HTML-string modal path…`) روی هر اجرا تضمین می‌کنند هیچ sink رشته‌-HTML
> به سورس‌ها برنگردد. طبقه‌بندی نهایی: [INNERHTML_AUDIT.md](INNERHTML_AUDIT.md).
> **ماندگاری (جدید):** دکمه‌ی «ذخیره» + ماندگاری داده‌ها و آخرین شیت باز روی reload —
> تست‌های `save: save-now button present`، `save: saveNow persists + read-back verified`،
> `save: open sheet remembered`، `save: indicator shows saved time` (jsdom) و
> `save: Save button persists data`، `save: reload restores data and lands on the same sheet`
> (مرورگر واقعی — reload واقعی صفحه).
> قراردادهای رفتاری حین refactor حفظ شدند (`data-act` delegation، dataset های
> `data-match`/`data-srcrow`/`data-ci`/`data-r`/`data-c`، merge با rowspan/colspan مثل اکسل،
> همگامی undo) — هر commit با سبز بودن هر دو لایه تست ثبت شده است.

## ۱. جریان‌های رفتاری اصلی (پوشش تست خودکار)

| جریان (ماکروی Excel) | معادل HTML | تست‌های خودکار | وضعیت |
|---|---|---|---|
| `Auto_Open / Workbook_Open (راه‌اندازی)` | `boot pipeline + verifySearchIndex` | `empty: no data sheets at boot`، `empty: system shell present`، `empty: search index empty`… | ✅ PASSED |
| `modSearchEngine.SearchRecords (جستجو)` | `modSearchEngine.SearchRecords` | `search: matches found`، `search: rendered`، `results: editable inputs` | ✅ PASSED |
| `modSearchEngine.SaveChanges (ذخیره ویرایش)` | `modSearchEngine.SaveChanges` | `savechanges: wrote back` | ✅ PASSED |
| `modAddRecord.AddNewRowToSheet (افزودن رکورد)` | `modAddRecord wizard + _runAddForm` | `add: wizard opens`، `add: row inserted`، `add: logged`… | ✅ PASSED |
| `modRemoveRecord.StartRemoveWizard (حذف/آرشیو)` | `modRemoveRecord.StartRemoveWizard` | `remove: no-match handled`، `remove: match prompt`، `remove: service prompt`… | ✅ PASSED |
| `modUndo.UndoLastRemove (واگردانی حذف)` | `modUndo.UndoLastRemove` | `undo: restored`، `undo: archive cleaned`، `undo: state cleared` | ✅ PASSED |
| `modChangeLog (ثبت تغییرات)` | `WriteChangeLog / renderLogView` | `log: entries` | ✅ PASSED |
| `modExport (خروجی)` | `modExport.* + ExportWorkbookXlsx` | `export: downloads`، `export: xlsx workbook built`، `export: round-trip data` | ✅ PASSED |
| `modUI.Protect/UnprotectControlPanel (قفل پنل)` | `modUI.Protect/UnprotectControlPanel` | `protect: prompt`، `protect: unlocked` | ✅ PASSED |
| `modNavigator.ShowSheetNavigator (ناوبری)` | `modNavigator.ShowSheetNavigator` | `navigator: grouped headers`، `navigator: cards` | ✅ PASSED |
| `modMapping.RefreshSearchIndex (ایندکس)` | `RefreshSearchIndex + verify/recover` | `import: search index on imported`، `index: corruption detected`، `index: recover rebuilds`… | ✅ PASSED |
| `clsWatcher (ناظر سلول‌های پنل)` | `clsWatcher bindings` | `watcher: key dropdown rebuilt`، `watcher: C11 cleared` | ✅ PASSED |
| `GetMatchRows (موتور تطبیق)` | `modMapping.GetMatchRows` | `GetMatchRows works`، `import: macro search sees new row` | ✅ PASSED |
| `ورود فایل داده (قابلیت جدید)` | `modImport + validateWorkbookData` | `import: xlsx lib loaded`، `import: workbook accepted`، `import: new sheets present`… | ✅ PASSED |
| `امنیت خروجی/escaping (سخت‌سازی)` | `escapeHtml/encJs + sanitizeSheetName` | `xss: malicious sheet name accepted as data`، `xss: sheet exists with literal name`، `xss: catalog handler is encoded`… | ✅ PASSED |
| `تراکنش و rollback (سخت‌سازی)` | `withTransaction(Sync)` | `txn: error rolled back`، `txn: success committed` | ✅ PASSED |

## ۲. رجیستری کامل ماکروها (75 ماکرو)

| ماژول | ماکرو | شرح | پوشش رفتاری |
|---|---|---|---|
| `Sheet` | `MaxRow` | MaxCol | 🔶 معادل پیاده‌شده — تست دستی |
| `C7` | `C16` | C23 | 🔶 معادل پیاده‌شده — تست دستی |
| `C7` | `C16` | C23 | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `Auto_Open` | اجرای خودکار هنگام باز شدن فایل (شروع watcher) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `StartWatcher` | شروع ناظر تغییرات C7/C23 (clsWatcher1) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `InstallDataManager` | نصب/بازسازی کامل دیتامanager | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `RefreshPanel` | بازسازی پنل کنترل و dropdown ها | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `FixControlPanelGrid` | اصلاح طرح‌بندی پنل | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `SetupSheetDropdown` | ساخت dropdown فیلتر شیت (C7) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `SetupAddSheetDropdown` | ساخت dropdown شیت مقصد (C16) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `SetupKeyDropdown` | ساخت dropdown ستون جستجو (C9) مطابق شیت انتخابی | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `SetupRemoveKeyDropdown` | ساخت dropdown ستون حذف (C25) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `SetupNavSheetDropdown` | ساخت dropdown ناوبری (C41) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `ToggleExactMatch` | کلید تطابق دقیق جستجو (B12) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `CreateExactMatchToggle` | ساخت کلید تطابق دقیق | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `NavigateToSheet` | باز کردن مستقیم شیت انتخابی (C41) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `ProtectControlPanel` | قفل کنترل پنل با رمز (شبیه‌سازی رفتار Excel، نه امنیت واقعی) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUI` | `UnprotectControlPanel` | باز کردن قفل کنترل پنل (رمز 1234 — شبیه‌سازی، نه امنیت واقعی) | 🔶 معادل پیاده‌شده — تست دستی |
| `modSearchEngine` | `SearchRecords` | جستجوی رکوردها (FULLTEXT / ستونی، ALL یا شیت خاص) | 🔶 معادل پیاده‌شده — تست دستی |
| `modSearchEngine` | `SaveChanges` | ذخیره ویرایش‌های نتایج در شیت‌های مبدأ | ✅ `savechanges: wrote back` |
| `modSearchEngine` | `OpenSearchResults` | باز کردن شیت نتایج جستجو | 🔶 معادل پیاده‌شده — تست دستی |
| `modSearchEngine` | `ClearSearchResults` | پاک کردن نتایج جستجو | 🔶 معادل پیاده‌شده — تست دستی |
| `modSearchEngine` | `RefreshSearchIndexCore` | بازسازی ایندکس جستجو (با پیام) | 🔶 معادل پیاده‌شده — تست دستی |
| `modSearchEngine` | `RefreshSearchIndexSilent` | بازسازی بی‌صدای ایندکس | 🔶 معادل پیاده‌شده — تست دستی |
| `modAddRecord` | `StartAddWizard` | ویزارد افزودن رکورد (شعبه / خودپرداز / فرم فیلدها) | 🔶 معادل پیاده‌شده — تست دستی |
| `modAddRecord` | `FindAtmRow` | یافتن ردیف جداسازی «شبکه خودپرداز» در شیت جاری | 🔶 معادل پیاده‌شده — تست دستی |
| `modRemoveRecord` | `StartRemoveWizard` | ویزارد حذف رکورد (انتخاب Match، نوع سرویس، آرشیو + حذف) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUndo` | `UndoLastRemove` | بازگردانی آخرین حذف (Undo Remove) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUndo` | `HasUndoState` | بررسی وجود وضعیت Undo | 🔶 معادل پیاده‌شده — تست دستی |
| `modUndo` | `ClearUndoState` | پاک کردن بافر Undo | 🔶 معادل پیاده‌شده — تست دستی |
| `modUndo` | `InitUndoSession` | شروع جلسه Undo (قبل از حذف) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUndo` | `FinalizeUndoSession` | نهایی‌سازی جلسه Undo | 🔶 معادل پیاده‌شده — تست دستی |
| `modMapping` | `RefreshSearchIndex` | بازسازی SYSTEM_SEARCH_INDEX از روی SYSTEM_SHEET_CONFIG | 🔶 معادل پیاده‌شده — تست دستی |
| `modMapping` | `GetMatchRows` | جستجوی ردیف‌های منطبق در ایندکس | ✅ `GetMatchRows works` |
| `modNavigator` | `ShowSheetNavigator` | کارت‌های انتخاب شیت (Navigator) | 🔶 معادل پیاده‌شده — تست دستی |
| `modNavigator` | `CloseNavigator` | بستن Navigator | 🔶 معادل پیاده‌شده — تست دستی |
| `modExport` | `ExportSearchResults` | خروجی نتایج جستجو (CSV) | 🔶 معادل پیاده‌شده — تست دستی |
| `modExport` | `ExportCurrentData` | خروجی داده جاری / ایندکس (CSV) | 🔶 معادل پیاده‌شده — تست دستی |
| `modExport` | `ExportChangeLog` | خروجی تاریخچه تغییرات (CSV) | 🔶 معادل پیاده‌شده — تست دستی |
| `modImport` | `ImportDataFile` | ورود فایل داده (اکسل/CSV/JSON) — اجرای ماکروها روی داده جدید | 🔶 معادل پیاده‌شده — تست دستی |
| `modImport` | `ExportWorkbookXlsx` | خروجی کامل داده‌ها به فایل اکسل (XLSX) | 🔶 معادل پیاده‌شده — تست دستی |
| `modImport` | `ResetToEmptyData` | پاک‌سازی همه داده‌ها و شروع خام | 🔶 معادل پیاده‌شده — تست دستی |
| `modValidation` | `VerifySearchIndex` | بررسی سلامت ایندکس جستجو (دترمینیستیک) | 🔶 معادل پیاده‌شده — تست دستی |
| `modValidation` | `RecoverSearchIndex` | بازسازی/بازیابی مطمئن ایندکس جستجو | 🔶 معادل پیاده‌شده — تست دستی |
| `modExportAllModules` | `ExportAllModules` | خروجی همه ماژول‌های VBA (بسته .bas) | 🔶 معادل پیاده‌شده — تست دستی |
| `modChangeLog` | `WriteChangeLog` | ثبت یک رویداد در CHANGE_LOG | 🔶 معادل پیاده‌شده — تست دستی |
| `modChangeLog` | `GetLogRowCount` | تعداد ردیف‌های لاگ | 🔶 معادل پیاده‌شده — تست دستی |
| `modValidation` | `ValidateRequired` | اعتبارسنجی فیلد اجباری | 🔶 معادل پیاده‌شده — تست دستی |
| `modValidation` | `ValidateNumeric` | اعتبارسنجی عددی بودن | 🔶 معادل پیاده‌شده — تست دستی |
| `modValidation` | `IsSearchIndexEmpty` | بررسی خالی بودن ایندکس | 🔶 معادل پیاده‌شده — تست دستی |
| `modHelpers` | `ClearOutputArea` | پاک‌سازی ناحیه خروجی (نتایج) | 🔶 معادل پیاده‌شده — تست دستی |
| `modHelpers` | `RefreshPanel` | بازسازی پنل (delegate به modUI) | 🔶 معادل پیاده‌شده — تست دستی |
| `modLayout` | `DrawControlPanelLayout` | ترسیم مجدد طرح کنترل پنل | 🔶 معادل پیاده‌شده — تست دستی |
| `modLayout` | `UnprotectCP` | باز کردن قفل پنل (بدون درخواست رمز — ابزار داخلی) | 🔶 معادل پیاده‌شده — تست دستی |
| `modButtonTools` | `AddGoToControlPanelButtons` | افزودن دکمه «کنترل پنل» به شیت‌ها | 🔶 معادل پیاده‌شده — تست دستی |
| `modButtonTools` | `GoToControlPanel` | رفتن به کنترل پنل | 🔶 معادل پیاده‌شده — تست دستی |
| `modCreateUndoButton` | `CreateUndoButton` | ساخت دکمه UNDO | 🔶 معادل پیاده‌شده — تست دستی |
| `modPatchFixes` | `FixButtonOnActions` | اصلاح اتصال دکمه‌ها به ماکروها | 🔶 معادل پیاده‌شده — تست دستی |
| `modFixUnlock` | `UnlockDataSheets` | رفع قفل همه شیت‌های داده (رمز 12346 — شبیه‌سازی، نه امنیت واقعی) | 🔶 معادل پیاده‌شده — تست دستی |
| `modConstants` | `InitArchiveSheetNames` | مقداردهی اولیه نام آرشیوها (سازگاری) | 🔶 معادل پیاده‌شده — تست دستی |
| `modConstants` | `SystemSheetNames` | فهرست نام شیت‌های سیستمی | 🔶 معادل پیاده‌شده — تست دستی |
| `modConstants` | `HideSystemSheets` | مخفی‌سازی شیت‌های سیستم (xlSheetVeryHidden) | 🔶 معادل پیاده‌شده — تست دستی |
| `modConstants` | `UnhideSystemSheets` | نمایش شیت‌های سیستم | 🔶 معادل پیاده‌شده — تست دستی |
| `modErrorLog` | `LogError` | ثبت خطا در CHANGE_LOG | 🔶 معادل پیاده‌شده — تست دستی |
| `modErrorLog` | `HandleError` | ثبت و نمایش خطا | 🔶 معادل پیاده‌شده — تست دستی |
| `modUnicode` | `ShowMsg` | نمایش پیام (MessageBoxW معادل) | 🔶 معادل پیاده‌شده — تست دستی |
| `modUnicode` | `ShowInput` | دریافت ورودی (InputBox معادل) | 🔶 معادل پیاده‌شده — تست دستی |
| `CFieldInput` | `SetupForm + Show` | دیالوگ YES=ورود / NO=رد / CANCEL=توقف برای هر فیلد | 🔶 معادل پیاده‌شده — تست دستی |
| `frmSectionPicker` | `SetupForm` | فرم انتخاب بخش: شعبه / خودپرداز / انصراف | 🔶 معادل پیاده‌شده — تست دستی |
| `modFormBuilder` | `EnsureFieldInputForm` | آماده‌سازی فرم ورود فیلد | 🔶 معادل پیاده‌شده — تست دستی |
| `modFieldInput` | `frmFieldInput` | نمونه ورود فیلد (اتصال به CFieldInput) | 🔶 معادل پیاده‌شده — تست دستی |
| `clsWatcher1` | `WatchSheet` | اتصال ناظر تغییرات به کنترل پنل | 🔶 معادل پیاده‌شده — تست دستی |
| `ThisWorkbook` | `Workbook_Open` | رویداد باز شدن فایل (راه‌اندازی کامل سیستم) | 🔶 معادل پیاده‌شده — تست دستی |
| `ThisWorkbook` | `Workbook_BeforeClose` | قفل پنل هنگام بستن | 🔶 معادل پیاده‌شده — تست دستی |
| `provinces` | `equipment` | carriers | ✅ `cats: mapping provinces/datacenters/equipment/costs/carriers/services` |

## ۳. ماژول‌های VBA فایل اصلی (27 ماژول با توضیح ثبت‌شده)

| ماژول VBA | شرح | وضعیت پورت |
|---|---|---|
| `CFieldInput.cls` | کلاس ورود فیلد (YES/NO/CANCEL) | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `ThisWorkbook.cls` | رویدادهای workbook | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `clsWatcher.cls` | ناظر تغییرات | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `clsWatcher1.cls` | ناظر تغییرات C7/C23 (نسخه بهبودیافته) | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `frmSectionPicker.frm` | فرم انتخاب بخش | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modAddRecord.bas` | ویزارد افزودن رکورد (شعبه/خودپرداز) | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modButtonTools.bas` | دکمه بازگشت به کنترل پنل | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modChangeLog.bas` | ثبت تغییرات (CHANGE_LOG) | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modConstants.bas` | ثابت‌ها و تشخیص شیت سیستمی | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modCreateUndoButton.bas` | ساخت دکمه UNDO | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modErrorLog.bas` | ثبت خطاها | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modExport.bas` | خروجی‌گیری (Excel/CSV) | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modExportAllModules.bas` | خروجی ماژول‌های VBA | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modFieldInput.bas` | ورود فیلد | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modFixUnlock.bas` | رفع قفل شیت‌ها | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modFormBuilder.bas` | سازنده فرم | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modHelpers.bas` | توابع کمکی | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modLayout.bas` | طرح‌بندی کنترل پنل | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modMapping.bas` | نگاشت فیلدها و ایندکس جستجو | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modNavigator.bas` | کارت‌های انتخاب شیت | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modPatchFixes.bas` | اصلاحات و اتصال دکمه‌ها | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modRemoveRecord.bas` | ویزارد حذف رکورد با آرشیو و Undo | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modSearchEngine.bas` | موتور جستجو، نتایج Match-Block، ذخیره تغییرات | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modUI.bas` | رابط کاربری، dropdown ها، toggle تطابق دقیق، محافظت پنل | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modUndo.bas` | بازگردانی حذف (بافر SYSTEM_UNDO_BUFFER) | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modUnicode.bas` | MessageBoxW فارسی | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |
| `modValidation.bas` | اعتبارسنجی ورودی‌ها | ✅ پورت شده (سورس VBA در `VBA_MODULES` نگه‌داری می‌شود) |

> مجموع ۹۷ ماژول VBA در `data.js` نگه‌داری و از داخل برنامه قابل مشاهده/خروجی است.

## ۴. پوشش آزمون‌های خودکار به تفکیک خوشه

| خوشه تست | تعداد |
|---|---|
| add | 5 |
| cats | 7 |
| empty | 5 |
| export | 3 |
| fixture | 2 |
| grid | 2 |
| hardening | 1 |
| import | 13 |
| index | 3 |
| init | 3 |
| log | 1 |
| navigator | 2 |
| other | 1 |
| protect | 2 |
| registry | 1 |
| remove | 6 |
| reset | 3 |
| results | 1 |
| savechanges | 1 |
| search | 2 |
| txn | 2 |
| undo | 3 |
| valid | 5 |
| validateWorkbookData | 1 |
| vba | 1 |
| watcher | 2 |
| xss | 6 |

## ۵. تضمین‌های سخت‌سازی (Hardening)

- ✅ `empty: no data sheets at boot`
- ✅ `empty: system shell present`
- ✅ `empty: search index empty`
- ✅ `empty: dashboard shows import CTA`
- ✅ `empty: catalog shows import CTA`
- ✅ `remove: undo valid`
- ✅ `xss: malicious sheet name accepted as data`
- ✅ `xss: sheet exists with literal name`
- ✅ `xss: catalog handler is encoded`
- ✅ `xss: malicious card rendered`
- ✅ `xss: click opens sheet, no script exec`
- ✅ `xss: grid cell escaped`
- ✅ `valid: corrupt xlsx rejected`
- ✅ `valid: empty csv rejected`
- ✅ `valid: state untouched after rejects`
- ✅ `valid: proto name sanitized`
- ✅ `valid: Object.prototype clean`
- ✅ `validateWorkbookData: api exposed`
- ✅ `txn: error rolled back`
- ✅ `txn: success committed`
- ✅ `index: corruption detected`
- ✅ `index: recover rebuilds`
- ✅ `index: search works after recover`
- ✅ `reset: workspace empty again`
- ✅ `reset: system shell intact`
- ✅ `reset: index cleared`

---
*تولیدشده خودکار از روی `src/ui.js` + `src/test/test_app.js`. بعد از تغییر ماکروها، بازتولید کنید.*
