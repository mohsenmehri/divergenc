# مدیریت تجهیزات FAM — بررسی از VDI دارای SSH

این نسخه صفحهٔ مستقل «عملیات شبکه»، Worker Token و Pairing را حذف می‌کند. ابزار در تب **تجهیزات** داخل FAM قرار دارد. وقتی خود FAM Server به تجهیزات SSH دسترسی ندارد، یک Connector سبک و موقت روی VDI دارای دسترسی SSH اجرا می‌شود.

```text
Browser کاربر → HTTPS → FAM روی 10.16.243.18
                         ↑ اتصال HTTPS خروجی
                      Connector روی VDI → SSH/22 تجهیز
```

هیچ پورت ورودی روی VDI لازم نیست و FAM Server به VDI اتصال آغاز نمی‌کند.

## جریان کار ساده

1. روی VDI، `START-FAM-EQUIPMENT-CONNECTOR.cmd` اجرا می‌شود و کاربر با حساب معمولی FAM خودش وارد می‌شود. Connector هیچ Token یا رمز را در فایل ذخیره نمی‌کند.
2. کاربر با همان حساب در HTTPS تأییدشدهٔ FAM وارد تب **تجهیزات** می‌شود.
3. IP خصوصی تجهیز، نام کاربری SSH/RADIUS و رمز موقت را وارد و دکمهٔ بررسی را می‌زند.
4. FAM اطلاعات را فقط در RAM درخواست نگه می‌دارد و از طریق همان HTTPS خروجی، یک job یک‌بارمصرف به Connector می‌دهد.
5. Connector از VDI فقط `show interfaces status` را اجرا می‌کند.
6. فقط نام پورت‌های `err-disabled` و نام/Description نمایش‌داده‌شده برای همان پورت (در صورت وجود) به UI برمی‌گردد؛ raw CLI output بازگردانده یا ذخیره نمی‌شود.
7. کاربر برای هر پورت گزارش‌شده دکمهٔ «تأیید رفع خطا» را می‌زند. Connector پیش از تغییر دوباره وضعیت همان پورت را بررسی می‌کند، فقط `shutdown` / `no shutdown` همان Interface را اجرا و دوباره کنترل می‌کند. `enable`، command آزاد و `write memory` وجود ندارد.

## حفاظت اطلاعات ورود

- username/password تجهیز فقط در حافظهٔ Browser، درخواست HTTPS، RAM موقت FAM و RAM Connector است.
- در SQLite، URL، log معمولی، browser storage، command-line یا فایل تنظیمات نوشته نمی‌شود.
- رمز تجهیز هر بار پس از پاسخ سرور از فرم پاک می‌شود. برای recovery، کاربر رمز را دوباره وارد می‌کند.
- عملیات recovery فقط تا پنج دقیقه پس از همان بررسی و فقط برای همان IP، همان username و همان پورت با ticket امضاشدهٔ سرور مجاز است.
- Connector فقط jobهای همان حساب FAM را می‌گیرد که هنگام اجرای Connector وارد شده است. Session آن حداکثر هشت ساعت است و بعد از پایان آن باید Connector مجدداً اجرا و Login شود.

## پیش‌نیاز VDI

- دسترسی خروجی HTTPS به `https://communication-02.toosbank.corp` و SSH/22 به تجهیزات لازم است.
- Windows PowerShell و OpenSSH Client (`ssh.exe`) باید روی VDI موجود باشند؛ Python، pip و Administrator لازم نیست. Connector هیچ نصب یا venv ایجاد نمی‌کند.
- اگر VDI Sign-out/Restart شود یا Session FAM تمام شود، Connector را دوباره اجرا کنید.
- برای بهره‌برداری دائمی، بهتر است تیم VDI همین Connector را روی VDI یا Jump Host مدیریت‌شده به‌صورت سرویس ثبت کند. این نسخهٔ آزمایشی عمداً user-mode و بدون Administrator است.
