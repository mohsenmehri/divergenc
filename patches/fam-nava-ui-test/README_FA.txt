FAM — پیش‌نمایش ظاهری نوا برای پنل اصلی

این ZIP فقط برای VM تستی FAM در https://ertebatat-fam است. این تغییر فقط ظاهر صفحهٔ اصلی FAM.html را به یک پوستهٔ روشن/مینیمال نزدیک به قالب «نوا» تبدیل می‌کند.

هیچ مورد زیر تغییر نمی‌کند:
- API، backend، SQLite، Excel و داده‌ها
- حساب‌ها، نقش‌ها، مجوزها یا sessionها
- Network Operations / Worker / Jobها
- گواهی، DNS، binding یا web.config IIS

روش اجرا:
1. ZIP را روی VM تستی کامل Extract کنید.
2. روی APPLY-FAM-NAVA-VISUAL-TEST.cmd راست‌کلیک و Run as administrator را انتخاب کنید.
3. تنها پیام معتبر موفقیت:

   FAM NAVA VISUAL TEST: SUCCESS

4. در مرورگر معمولی به https://ertebatat-fam/FAM.html بروید و پس از ورود، پنل اصلی را بررسی کنید.

پچ پیش از تغییر SHA-256 را بررسی می‌کند، IIS physical path واقعی سایت را از HTTPS binding پیدا می‌کند، از FAM.html قبل در مسیر زیر backup می‌گیرد و در صورت خطا خودکار restore می‌کند:

C:\ProgramData\FAM\nava-visual-test-backups\

بازگشت، اگر ظاهر را نخواستید:
- روش ساده: ROLLBACK-LATEST-FAM-NAVA-VISUAL-TEST.cmd را با Run as administrator اجرا کنید. آخرین backup همین تست restore می‌شود.
- مسیر Backup اعلام‌شده در خروجی را نیز نگه دارید؛ روش دستی این است که FAM.html همان پوشه را به Actual IIS physical path نمایش‌داده‌شده در خروجی برگردانید و سایت IIS را restart کنید.

این بسته «نسخهٔ آزمایشی ظاهری» است؛ برای تأیید طراحی است و نباید بدون تأیید جداگانه روی سرور عملیاتی نصب شود.
