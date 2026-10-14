# بررسی کامل کد — `Wolf M-A v4 | Crypto & Gold`

**نوع اسکریپت:** Pine Script v6 — Indicator (overlay)
**حجم:** ~۱۵۰۰ خط، ۶ بخش محاسباتی (Trend / Structure / FVG / Liquidity / OrderBlock / Macro) + جدول + Fib
**روش بررسی:** بازخوانی خطبهخط + تطبیق با مستندات رسمی Pine v6 (`request.security`, اصول `request.*`، محدودیت درخواستها، اشیای گرافیکی)
**تاریخ:** 2026-10-14

---

## ۱) جمع‌بندی اجرایی (اگر فقط این را می‌خوانی)

کد **از نظر ساختاری و نگارشی سالم است** و کامپایل می‌شود؛ منطق پایه (ساختار، OB، FVG، لیکوییدیتی، فایب) درست پیاده شده و کارهای خوبی مثل محدودکردن آرایه‌ها، غیرفعال‌کردن FVG قدیمی، ترسیم جدول فقط روی کندل آخر و هندل‌کردن `na(volume)` انجام شده.
اما **سه دستهٔ ایراد جدی** دارد: (الف) معماری `request.security` که هم به سقف ۴۰ درخواست داده نزدیک است و هم نیتِ سازنده را برآورده نمی‌کند، (ب) چند **کد مرده / شرط غیرقابل‌دسترس** که باعث می‌شود بخشی از منطق هرگز فعال نشود، (ج) **دوگانگی «تأیید روی بسته شدن کندل»** بین TF جاری و ستون‌های تایم‌فریمی.

### جدول اولویت‌دار یافته‌ها

| # | شدت | موضوع | اثر عملی |
|---|-----|-------|----------|
| C1 | 🔴 بحرانی | ۳۹ درخواست داده، یک قدم مانده به سقف ۴۰ | با افزودن هر TF/نماد جدید → خطای زمان اجرا و از کار افتادن اسکریپت |
| C2 | 🔴 بحرانی | وابستگی `expression` به متغیرهای گلوبالِ کانتکست چارت + تکرار ۵ برابری موتور | مصرف CPU زیاد، وابستگی به ترتیب کد، نتایج غیرقابل‌پیش‌بینی |
| C3 | 🔴 بحرانی | سیگنال‌های `Transition` هیچ‌وقت فعال نمی‌شوند (سقف اعتماد ۵۳ < آستانه ۵۵) | دو ستاپ از شش ستاپ مُرده است |
| C4 | 🔴 بحرانی | فیلتر ماکرو در حالت Gold عملاً همیشه true است | فیلتر ماکرو بی‌اثر؛ سیگنال‌ها بدون تأیید ماکرو صادر می‌شوند |
| C5 | 🟠 مهم | `confirmOnClose` فقط روی TF جاری؛ ستون‌های TF ری‌پینت می‌کنند | روی کندل جاری جدول مخالف سیگنال نشان می‌دهد |
| C6 | 🟠 مهم | تناقض اعتماد (Confidence) در حالت Transition بین ستون‌ها و TF جاری | عدد ستون `Cf` برای Transition همیشه ۵۰ است ولی واقعاً ۴۲–۵۳ |
| C7 | 🟠 مهم | منطق «فریز ۳ کندلی» سطوح ساختار | سطح ساختار می‌تواند روی سوینگ واقعی جا بماند → BOS/CHoCH زود یا دیر |
| C8 | 🟠 مهم | لیبل‌های OB هرگز پاک نمی‌شوند | شلوغی چارت + اشغال سهمیه ۵۰۰ لیبل |
| C9 | 🟡 متوسط | ورودی‌های نماد بی‌استفاده (`s01`, `s02_gold`, `s01_gold`) و ورودی هم‌نماد تکراری | کاربر فکر می‌کند تنظیمش اثر دارد، ولی نماد هاردکد است |
| C10 | 🟡 متوسط | ۶ ورودی رنگ `display.none` که هیچ‌جا استفاده نشده + یک `import` بی‌استفاده | کد و زمان کامپایل اضافه؛ رنگ‌ها هاردکد شده‌اند |
| C11 | 🟡 متوسط | `getTrendColor()` روی رشته‌های غیر-Trend فراخوانی می‌شود | همه‌جا خاکستری برمی‌گرداند؛ رنگ‌های «Strong/High/Rising» فقط با ایموجی منتقل می‌شوند |
| C12 | ⚪ جزئی | `max_bars_back = 5000` بی‌دلیل بزرگ + `MAX_HIST = 2000` | مصرف حافظه (خود TradingView آن را از عوامل خطای memory می‌داند) |

---

## ۲) نقاط قوت (که نباید در بازنویسی از دست برود)

1. **جداسازی موتورها**: Structure / FVG / Liquidity / OB / Macro هر کدام مستقل و خوانا نوشته شده‌اند.
2. **مدیریت منابع گرافیکی**: لیبل و باکس‌ها با `array` نگه‌داری و با `while` هرس می‌شوند (`fvgHistoryNbr`, `structHistoryNbr`, `liqMaxCount`) — یعنی تعداد اشیا کنترل‌شده است.
3. **FVG box با محدوده درست**: `box.new(bar_index-2, low[0], bar_index, high[2])` برای FVG صعودی درست است (top > bottom).
4. **اصطکاکِ OB استاندارد**: `ob_os` با مقایسه `high[ob_length]` با `upper/lower` و پیوت حجم — همان الگوی کلاسیک و درست.
5. **محافظت‌ها**: `na(volume) ? 1.0`، `atr + 1e-6`، `math.max(_left, bar_index - 500)`، `f_safeHigh/f_safeLow` برای ایندکس‌های خارج از محدوده، `f_clampStartIdx`.
6. **جدول فقط روی آخرین کندل** رندر می‌شود (`shouldRender = barstate.islast`) → هزینهٔ رشته‌سازی روی کندل‌های تاریخی صفر است. این نکتهٔ خیلی مهمی است که در بسیاری از اسکریپت‌ها رعایت نمی‌شود.
7. **آلرت‌ها** برای OB و سیگنال TF جاری وجود دارد.
8. **تطبیق پارامترها**: ترتیب آرگومان‌های `f_getMacroRegime` / `f_computeBias` با تعریف تابع یکی است (`isGoldMode, _dU, _u10U, _vU, _tU, _bU, _uU, _aU`) — بررسی شد و جابجایی وجود ندارد.

---

## ۳) 🔴 ایرادهای بحرانی

### C1 — سقف ۴۰ درخواست داده: الان ~۳۹ درخواست یکتا داری

طبق مستندات، در Pine v6 حداکثر **۴۰ درخواست یکتا (`request.*()`) در هر اجرا** مجاز است (در پلن Ultimate ۶۴) و خطای زمان اجرا این است:

```
Script requests too many securities: 48. The limit is 40
```

حالا بشمار:

| منبع | تعداد |
|------|-------|
| ۷ درخواست مستقیم در گلوبال (`BTC.D`, `USDT.D`, `TOTAL2`, `TOTAL`, `DXY`, `US10Y`, `VIX`) | 7 |
| ۴ درخواست بیرونی برای TFها | 4 |
| ۷ درخواست تودرتو داخل `f_getAllTFData()` × ۴ فراخوانی | **28** |
| **جمع** | **≈ 39** |

دو نکته‌ی کلیدی که اینجا دارد کار می‌کند:

* **`request.*()` داخل یک تابع، به‌ازای هر بار فراخوانی، یک درخواست مجزا حساب می‌شود.** (نمونهٔ رسمی: تابعی با ۱۲ درخواست که ۴ بار صدا زده شود → ۴۸ درخواست و خطا.)
* **درخواست تودرتو، کانتکست بیرونی را ارث می‌برد**: مستندات می‌گوید «if such a `request.security()` call is evaluated by another `request.*()` call, the nested request *inherits* that `request.*()` call’s ticker ID or timeframe information». یعنی `request.security('CRYPTOCAP:TOTAL', timeframe.period, close)` داخل درخواست TF=۳ دقیقه، در واقع `TOTAL@3m` می‌شود و با `TOTAL@5m` در درخواست بعدی **یک منبع داده‌ی متفاوت** است → یکی‌یکی به سقف اضافه می‌شود.

**نتیجه:** با اضافه‌کردن یک ستون TF پنجم، یا یک نماد ماکرو بیشتر (مثلاً `TOTAL3`) یا یک درخواست برای آلرت‌ها، اسکریپت با خطای زمان اجرا متوقف می‌شود. الان روی لبه‌ی پرتگاه ایستاده‌ای.

**راه‌حل (بهترین و کم‌دردسرترین):**

```pine
indicator('Wolf M-A v4 | Crypto & Gold', overlay = true, max_bars_back = 2500,
     max_lines_count = 500, max_labels_count = 500, max_boxes_count = 500,
     dynamic_requests = false)     // ← این یک کلمه، تقریباً همه‌ی مشکل را حل می‌کند
```

با `dynamic_requests = false` طبق مستندات: «the script evaluates each call *independently*, passing the first call’s calculated value directly into the second call rather than executing the first call within the second context». یعنی:

* ماکرو یک‌بار و در کانتکست چارت محاسبه می‌شود و همان مقدار به همهٔ ستون‌ها پاس داده می‌شود → **۷ درخواست به‌جای ۲۸ درخواست** و مجموع ≈ ۱۱.
* ضمناً «رژیم ماکرو» به‌درستی یک مفهوم **بازار-محور** می‌شود (الان برای هر TF جدا محاسبه می‌شود، که با اسم ستون `Macro 🌍` تناقض دارد — رژیم ماکرو نباید در ۱ دقیقه و ۱ روز یکی نباشد).
* مزیت جانبی: درخواست‌های یکسانِ تکراری Dedupe می‌شوند.

⚠️ نکته: با `dynamic_requests=false`، هر `request.*()` که داخل تابع باشد باید در **گویال اسکوپ** فراخوانی شود — که در کد شما همین‌طور است. ✅

---

### C2 — `request.security` روی متغیرهای گلوبال: کد تکرار می‌شود، مقدار نه

در `f_getAllTFData()` این متغیرهای **گلوبال و mutable** استفاده شده‌اند:

```pine
_sd  = structureDirection      // var int  → با := تغییر می‌کند
_rHH = _rollingHH               // var bool → با := تغییر می‌کند
...
_bupsf = not na(structureHigh) ? ... : 0.0     // structureHigh: var float
_bdnsf = not na(structureLow)  ? ... : 0.0
```

طبق مستندات رسمی Pine (بخش *Requestable data → Declared variables*):

> «When using a variable as the expression argument of a `request.*()` call, it's important to note that the function only duplicates code that affects the variable *before* the call. It *cannot* copy any subsequent code following the call.»

یعنی کامپایلر **کدِ سازندهٔ وابستگی‌ها را در کانتکست درخواستی بازتولید می‌کند**، نه اینکه مقدار لحظه‌ای متغیر چارت را بفرستد. نتیجه‌ها:

1. **موتور ساختار (پیوت‌تراکینگ + محاسبهٔ `structureHigh/Low`) چهار بار اضافه در کانتکست‌های ۳m/۵m/۱۵m/۱D اجرا می‌شود**، به‌علاوهٔ یک بار در چارت → ۵ برابر شدن هزینه. با `ta.highestbars`، حلقه‌ها، `ta.ema`ها و `math.sum`ها.
2. **هرچه کد را پایین‌تر از فراخوانیِ `request.security` اضافه کنی، در ستون‌ها اثر نمی‌کند** (کامپایلر فقط کد «قبل از کال» را کپی می‌کند). این یک تله‌ی نگهداری (maintenance trap) است: اگر بعداً ترتیب کد را عوض کنی، خروجی ستون‌ها بی‌سروصدا تغییر می‌کند.
3. **`_gLastHigh/_gLastLow`، `_swH/_swL` (پیوت‌های ذخیره‌شده)** هم به همین شکل تکرار می‌شوند.

**راه‌حل پیشنهادی:** تابع را **کاملاً خودکفا (self-contained)** کن؛ فقط از پارامترها و built-inها استفاده کند و هیچ متغیر `var` گلوبال نخواند. چیزهایی که واقعاً از بیرون لازم دارد را به‌صورت آرگومان پاس بده… ولی دقت کن که آرگومانِ متغیرِ mutable هم همان مشکل را دارد.

ساده‌ترین مدل درست:

```pine
// بهجای سناریوی فعلی، ساختار هر TF را «داخل همان کانتکست» از صفر بساز:
f_tfEngine(int _structLookback, int _len, int _emaF, int _emaS, int _atrL) =>
    // همهچیز اینجا ساخته میشود؛ هیچ متغیر گلوبالی خوانده نمیشود
    _swH = ta.pivothigh(high, _structLookback, _structLookback)
    ...
```

…یا اگر نمی‌خواهی بازنویسی کنی، حداقل با `dynamic_requests = false` (پچ C1) بخش ماکرو را از این مسیر بیرون بیاور و در کامنت بالای تابع بنویس «این تابع نباید به متغیر گلوبال mutable وابسته باشد».

---

### C3 — ستاپ‌های Transition هرگز شرط اعتماد را رد نمی‌کنند (کد مرده‌ی قطعی)

```pine
_setupTransBull = trendState == "Transition" and dispIsBullish and liqSweepLow  and confidenceIndex >= 55
_setupTransBear = trendState == "Transition" and dispIsBearish and liqSweepHigh and confidenceIndex >= 55
```

اما در `_computeConfidenceIndex`:

```pine
else            // حالت Transition
    _tc = ((liqSweepLow or liqSweepHigh) ? 15.0 : 0.0) +
          ((dispIsBullish or dispIsBearish) ? 12.0 : 0.0)
    _s  := 42.0 + _tc * 0.4
```

بیشینهٔ `_tc` برابر ۲۷ است → `_s = 42 + 27×0.4 = 52.8` → `math.round` → **۵۳**. یعنی `confidenceIndex >= 55` **هرگز** برقرار نمی‌شود. پس دو ستاپ از شش ستاپ موتور Setup، برخلاف نیت طراحی، هیچ‌وقت شلیک نمی‌کنند (و در نتیجه `_anyLongRaw/_anyShortRaw` هم هیچ‌وقت از این مسیر پر نمی‌شود).

**تصحیح پیشنهادی (یکی را انتخاب کن):**

```pine
// گزینهٔ ۱ — مقیاس را بالا ببر تا ۵۵ قابل دسترس شود (بدون تغییر آستانهها)
_s := 35.0 + _tc * 0.8        // بیشینه = 35 + 21.6 = 56.6 ✅

// گزینهٔ ۲ — آستانهٔ ستاپها را کوچک کن
_setupTransBull = ... and confidenceIndex >= 50
```

⚠️ همین ایراد در نسخهٔ TFها هم هست ولی آنجا وضعیت بدتر است — ببین C6.

---

### C4 — فیلتر ماکرو در حالت Gold عملاً بی‌اثر است

```pine
_dollarWeak    = not dxyUp
_macroAllowLongGold  = _riskOffGold or _inflationGold or _dollarWeak
```

چون `_dollarWeak = not dxyUp` و این جمله با `or` به انتهای عبارت اضافه شده، **هر وقت DXY بالا نرود شرط Long برقرار است** و دو جملهٔ قبلی عملاً زائد می‌شوند:

```
_macroAllowLongGold  ≡  (not dxyUp) or (vixUp and dxyUp)
```

یعنی: **تنها زمانی Long ممنوع می‌شود که DXY در حال رشد باشد و VIX افتاده باشد.** به همین شکل:

```pine
_macroAllowShortGold = _riskOnGold = not vixUp and not dxyUp
```

و در Setup Engine:

```pine
_macroAllow = isGoldMode ? (_macroAllowLongGold or _macroAllowShortGold) : (...)
```

در حالت Gold این `_macroAllow` تقریباً **همیشه true** است (تنها حالتی که false می‌شود: DXY بالا + VIX پایین). پس شرط `and _macroAllow` در `_setupBullCont/_setupBearCont` عملاً حذف شده است — در حالی که کل نکتهٔ این تابع این است که ستاپ‌ها هم‌جهت با ماکرو باشند.

**همین باگ در نسخهٔ درون‌کانتکست هم عیناً کپی شده:**

```pine
_macroLong_t = isGoldMode ? ((_vU and _dU) or (_vU and not _dU and _u10U) or not _dU) : ...
```

که به `not _dU` فرو می‌ریزد و در `_alCnt` (شمارش هم‌راستایی) استفاده می‌شود → **یکی از ۵ امتیاز هم‌راستایی همیشه به‌صورت رایگان داده می‌شود** و آستانهٔ `_alignCount >= 3` برای سیگنال AI ضعیف می‌شود.

**پچ پیشنهادی:**

```pine
// تعریف سختگیرانهتر «دلار ضعیف» برای طلا: نه دلار بالا برود، نه بازدهی اوراق
_dollarWeak = not dxyUp and not us10yUp

// و در f_getAllTFData هم دقیقاً همین:
// _dWeak_t = not _dU and not _u10U
// _macroLong_t = (_vU and _dU) or (_vU and not _dU and _u10U) or _dWeak_t
```

(اگر می‌خواهی رفتار فعلی حفظ شود، حداقل متغیر `_dollarWeak` را حذف کن تا خوانندهٔ کد گمراه نشود و کامنت بگذار که این فیلتر آگاهانه ضعیف است.)

---

### C5 — تناقض «تأیید روی بسته شدن کندل» با ستون‌های TF

```pine
confirmOnClose = input.bool(true, '✅ تأیید روی بسته شدن کندل', ...)
_barConfirmed  = not confirmOnClose or barstate.isconfirmed
...
_aiLong  = _aiLongRaw  and _barConfirmed
_aiShort = _aiShortRaw and _barConfirmed
sig_cur_confirmed = _barConfirmed ? sig_cur : "⏳ " + sig_cur
```

تأیید فقط روی **TF جاری** اعمال می‌شود. اما `CT1..CT4` از `request.security` می‌آیند که به‌صورت پیش‌فرض `lookahead_off` و **بدون آفست** است؛ یعنی روی کندل در حال تشکیل، مقدار ستون‌های ۳m/۵m/۱۵m/۱D لحظه‌به‌لحظه عوض می‌شود و بعد از بسته‌شدن کندلِ HTF ثابت می‌شود (و با ری‌استارت اسکریپت، کندل‌های realtime قبلی ری‌پینت می‌شوند). این رفتار مستند است:

> «request.security() only confirms new values after a realtime bar closes in its specified context… the script will *repaint* those values after it restarts.»

نتیجه‌ی عملی برای کاربر: ستون `Bi/Cf/سیگنال` یک TF می‌تواند وسط کندل «LONG» باشد و آخر کندل «WAIT» شود — بدون هیچ هشداری در UI.

**پچ (پایدار کردن ستون‌ها، به قیمت یک کندل تأخیر):**

```pine
// همهچیز را یک کندل عقب ببر و lookahead را روشن کن → بدون ری‌پینت
f_getAllTFDataStable() =>
    _sd  = structureDirection
    ... (محاسبات دستنخورده)
    [_trendFull[1], math.round(_conf[1]), _lbInt[1], _sbInt[1],
     _ra1[1], _ra2[1], _ra3[1], _ra4[1], _macroReg[1], _alCnt[1], _alCntB[1]]

[CT1, CONF1, lb_tf1, sb_tf1, ra1_tf1, ra2_tf1, ra3_tf1, ra4_tf1, macro_tf1, alCnt_tf1, alCntB_tf1] =
     request.security(syminfo.tickerid, ticker1TFCustom, f_getAllTFDataStable(),
         lookahead = barmerge.lookahead_on)
```

⚠️ توجه: این تغییر **فقط** برای ستون‌های نمایشی خوب است؛ برای آلرت‌ها هیچ‌وقت روی داده‌ی ری‌پینت‌شدنی آلرت نساز. حداقل کاری که باید بکنی این است که در همین حالت فعلی، یک سلول «وضعیت» اضافه کنی که وقتی `barstate.isrealtime` است بنویسد «مقادیر ستون‌ها موقت است».

❗اگر فکر می‌کنی این رفتار «قابلیت» است، حتماً در README/توضیحات اسکریپت ذکرش کن؛ در بازار پاین اسکریپت این دقیقاً همان چیزی است که به‌عنوان «ری‌پینت» شناخته می‌شود.

---

## ۴) 🟠 باگ‌های منطقی

### C6 — اعتمادِ Transition در ستون‌ها همیشه ۵۰ است

در `f_getAllTFData()` بلوک `_conf` فقط سه حالت را پوشش می‌دهد:

```pine
float _conf = 50.0                       // ← مقدار اولیه
if _trendFull == "Bull"
    ...
else if _trendFull == "Bear"
    ...
else if _trendFull == "Range"
    ...
// ← حالت "Transition" هیچ else ندارد → ۵۰ میماند
```

اما در کانتکست چارت `confidenceIndex` برای Transition بین **۴۲ تا ۵۳** است. پس ستون `Cf` هنگام Transition همیشه `50~` نشان می‌دهد، در حالی که ستون TF جاری عدد واقعی را نشان می‌دهد → **جدول با خودش ناسازگار است**.

**پچ:**

```pine
else if _trendFull == "Transition"
    _tcC = ((_lsl or _lsh) ? 15.0 : 0.0) + ((_dispb or _dispr) ? 12.0 : 0.0)
    _conf := math.max(0.0, math.min(100.0, math.round(35.0 + _tcC * 0.8)))
```

---

### C7 — فلگ‌های Rolling پیوت، همیشه به‌روز نمی‌شوند

```pine
var bool _rollingHH = false
...
if not na(_swH)
    _rollingHH := not na(_gLastHigh) and _swH > _gLastHigh
    _rollingLH := not na(_gLastHigh) and _swH < _gLastHigh
```

این فلگ‌ها **بین دو پیوت، مقدار قبلی خود را نگه می‌دارند** (رفتار درست و کلاسیک). اما توجه کن که `_structBullStrong = _structBull and _rollingHH and _rollingHL` می‌تواند تا مدت‌ها با «پژواک» یک پیوت قدیمی true بماند. اگر می‌خواهی این فلگ‌ها «تازه» باشند، در صورت فاصلهٔ زیاد از آخرین پیوت آن‌ها را به `false` برگردان:

```pine
// مثال: اگر آخرین پیوت بیشتر از N کندل پیش بوده، فلگ را بیاعتبار کن
lastPivotBarH = ta.valuewhen(not na(_swH), bar_index, 0)
_rollingHH := _rollingHH and (bar_index - lastPivotBarH) <= structLookback * 4
```

(اختیاری/سلیقه‌ای — ولی رفتار فعلی را حتماً در کامنت توضیح بده.)

---

### C7b — منطق «فریزِ سه‌کندلی» سطوح ساختار

```pine
if not na(structureLow) and low < structureLow and (structureDirection == 0 or structureDirection == 1)
    _bOk = not isStructBodyCandleBreak or not (bar_index[1] > structureLowStartIndex and
                                              bar_index[2] > structureLowStartIndex and
                                              bar_index[3] > structureLowStartIndex)
    if _bOk
        structureLow := low
        structureLowStartIndex := bar_index
```

با `isStructBodyCandleBreak = true` (پیش‌فرض)، شرط `_bOk` یعنی: «فقط تا ۳ کندل بعد از شروع ساق می‌توانی کف ساختار را دنبال کنی؛ بعد از آن کف **قفل** می‌شود».

پیامد: در یک ساق نزولی که بیش از ۳ کندل ادامه دارد و کف‌های پایین‌تری می‌سازد، `structureLow` روی مقدار قدیمی قفل می‌ماند و اولین باری که `_bodyLow` از آن پایین‌تر بزند، **CHoCH/BOS** صادر می‌شود — یعنی ممکن است وسط روند، به‌جای ادامهٔ روند، سیگنال چرخش بگیریم. این «قفل ۳ کندلی» عمدی به‌نظر می‌رسد (برای جلوگیری از «دنبال‌کردن» بی‌پایان)، ولی نسبت به سوینگ‌های واقعی شکننده است و حتماً باید بک‌تست شود.

**پیشنهاد:** این منطق را با `nn` (ورودی `fasele`) گره بزن تا کاربر بتواند کنترلش کند، نه اینکه عدد ۳ هاردکد باشد:

```pine
_chaseBars = nn      // یا یک input.int جداگانه با نام "Structure Chase Bars"
_bOk = not isStructBodyCandleBreak or bar_index - structureLowStartIndex <= _chaseBars
```

و در نسخهٔ High هم همین را قرینه کن (الان `3` در دو جا هاردکد شده و با `nn` که در گروه Fib تعریف شده هیچ ارتباطی ندارد — این خودش یک بوی کد است).

---

### C7c — منطق `lowStructBreakPrice[1..3] >= structureLow` (تشخیص BOS)

```pine
isStructureLowBroken = not na(structureLow) and bosValid and _breakDnOk and
     lowStructBreakPrice < structureLow and bar_index > structureLowStartIndex and
     lowStructBreakPrice[1] >= structureLow and lowStructBreakPrice[2] >= structureLow and
     lowStructBreakPrice[3] >= structureLow
```

این یعنی «شکست از اولین کندلی که در ۴ کندل اخیر عبور کرده». بعد از یک رنج یا پس از هر بار `structureLow := low`، این شرایط می‌تواند به‌سادگی از دست برود یا برعکس، بلافاصله بعد از یک به‌روزرسانی سطح، شلیک کند. اگر BOS/CHoCH پایهٔ تصمیم‌گیری سیگنال است، منطق را به این شکل شفاف‌تر کن:

```pine
// pre-break: در N کندل قبل هیچ عبوری نبوده
_cleanBefore = ta.lowest(lowStructBreakPrice, 4)[1] >= structureLow
isStructureLowBroken = not na(structureLow) and bosValid and _breakDnOk and
     lowStructBreakPrice < structureLow and _cleanBefore
```

### C7d — وزن یک لیکوییدیتی در Bias

در `f_computeBias`:

```pine
_lf = _lsl ? 0.85 : _lsh ? 0.15 : 0.5
_raw = _norm(_sf)*0.22 + _norm(_emf)*0.18 + _norm(_lf)*0.16 + ...
```

یعنی **یک کندلِ سوییپ کف، ۱۶٪ از کل امتیاز Bias را یک‌شبه جابه‌جا می‌کند** و چون `_spreadScore` آستانه‌های تیزش دارد (±۶ = ±۸ امتیاز و ±۱۲ = ±۱۸ امتیاز)، بایاس خیلی عصبی می‌شود. توصیه: روی `_lf` یک هموارسازی/هیسترزیس بگذار (`_lf := 0.5 + (_lf - 0.5) * 0.8` یا نگه‌داری سوییپ به مدت ۲–۳ کندل) و آستانه‌های `_spreadScore` را دوباره کالیبره کن.

---

## ۵) 🟡 کارایی، حافظه و ریسک‌های زمان اجرا

### P1 — `max_bars_back = 5000` بی‌دلیل بزرگ است

تنها جایی که واقعاً به عمق ۲۰۰۰ نیاز داری `f_safeHigh/f_safeLow` با `MAX_HIST = 2000` است (و آن هم فقط در لحظهٔ شکست ساختار استفاده می‌شود). `max_bars_back` بزرگ، خودش یکی از عوامل خطای حافظه (`RE10139`) در TradingView است. پیشنهاد:

```pine
MAX_HIST = 500          // ← از 2000 به 500
indicator(..., max_bars_back = 600)
```

نکتهٔ مهم: **محدودیت اشیای گرافیکی مربوط به گذشته ۹۹۹۹ کندل است و به `max_bars_back` ربطی ندارد** — پس `f_clampStartIdx` نیازی به ۲۰۰۰ ندارد؛ ۵۰۰ برای «ساختار جاری» کافی است. (محدودیت ۵۰۰ کندل مربوط به **آینده** است: `bar_index + 500`؛ در کد شما `nn = 3` است پس کاملاً ایمن.)

### P2 — محاسبات تکراری

| مورد | وضعیت |
|------|-------|
| `ta.ema(close, 50)` | یک‌بار به‌عنوان `_fvgEma`، یک‌بار `_fvge_cur`، یک‌بار در `f_getAllTFData`، یک‌بار در `f_computeBias` (به‌ازای هر TF) → **۴ تا ۸ نسخهٔ جدا** |
| `ta.ema(close, emaFastLen/SlowLen)` | هم در بدنهٔ اصلی، هم داخل `f_computeBias` (که ۵ بار صدا زده می‌شود) |
| `ta.highest/lowest(high, eqLen)` | `highest10` و `_h10_cur` | 
| محاسبهٔ FVG count | یک‌بار گلوبال (`_fvgbc...`) و یک‌بار در `f_getAllTFData` |

توصیه: هر سری را فقط یک بار بساز و در توابع پاس بده (با رعایت C2 برای کانتکست‌ها):

```pine
_atr = ta.atr(atrLen)
_emaF = ta.ema(close, emaFastLen)
_emaS = ta.ema(close, emaSlowLen)
_fvgEma = ta.ema(close, 50)      // یکی بهجای سهتا
```

### P3 — ریسک `na` برای پیوت حجم (نمادهای بدون Volume)

```pine
phv = ta.pivothigh(volume, ob_length, ob_length)
[bull_top, ...] = ob_get_coordinates(bool(phv) and ob_os == 1, ...)
```

روی نمادهایی که `volume` ندارند (برخی نمادهای فارکس/فلزات در برخی بروکرها) `volume` می‌تواند `na` باشد → `phv` می‌شود `na` → `bool(phv)` می‌شود `na` → شرط falsy → **موتور Order Block کامل بی‌صدا از کار می‌افتد** بدون هیچ هشداری. راه‌حل:

```pine
_volSrc = na(volume) ? (high - low) : volume           // فالبک: رنج کندل
phv     = ta.pivothigh(_volSrc, ob_length, ob_length)
```

### P4 — ریسک `na` در `switch` بدون default

```pine
ob_get_line_style(style) =>
    switch style
        '⎯⎯⎯' => line.style_solid
        '----' => line.style_dashed
        '····' => line.style_dotted
```

اگر روزی گزینه‌ها یا کاراکترها تغییر کنند، خروجی `na` می‌شود و `line.new(..., style = na)` خطای زمان اجرا می‌دهد. یک شاخهٔ پیش‌فرض اضافه کن:

```pine
        => line.style_solid
```

### P5 — لیبل‌های OB هرگز پاک نمی‌شوند

```pine
lbl = label.new(bar_index, avg, 'OB', style = label.style_none, ...)
array.unshift(ob_lbl, lbl)
...
// در ob_set_order_blocks فقط آخرین ext_last لیبل جابهجا میشوند:
label.set_xy(get_lbl, math.round((_safeLeft + bar_index) / 2), _avg_val)
```

لیبل‌های قدیمی‌تر نه حذف می‌شوند، نه متنشان خالی می‌شود → روی چارت انبوهی از «OB» باقی می‌ماند (و تا سقف ۵۰۰ لیبل، جای لیبل‌های FVG/ساختار را می‌گیرند). کافی است در همان `barstate.islast` بقیه را پاک/مخفی کنی:

```pine
if barstate.islast
    for i = 0 to array.size(ob_lbl) - 1
        if i > ext_last - 1
            label.set_text(array.get(ob_lbl, i), "")     // یا label.delete(...)
```

### P6 — `alertcondition(not na(bull_ob), ...)` و `_aiLong/_aiShort`

`alertcondition` فقط شرط می‌سازد؛ کاربر باید دستی آلرت بسازد. اگر می‌خواهی هشدار «خودکار» باشد، `alert()` را در کنارشان بگذار (و توجه: `alert()` فقط در کندل تأییدشده صدا بزن تا ری‌پینت آلرت ندهی):

```pine
if _aiLong and barstate.isconfirmed
    alert('AI Long Signal - ' + syminfo.ticker + ' @ ' + str.tostring(close), alert.freq_once_per_bar_close)
```

---

## ۶) 🔵 مسائل جدول و نمایش

| # | مورد | توضیح | اصلاح |
|---|------|-------|-------|
| U1 | `getTrendColor(dxy_tf1)` روی رشتهٔ `"Strong 🟢"` | تابع فقط `Bull/Bear/Range/Transition` را می‌شناسد → **همیشه** خاکستری برمی‌گرداند (برای ردیف‌های DXY/US10Y/VIX/BTC.D/TOTAL/USDT.D) | یک تابع رنگ مخصوص بساز: `getBoolColor(_s) => str.contains(_s,"🟢") ? green : red` |
| U2 | `"🔴 " + currentTFLabel` در هدر هر دو حالت | حتی وقتی روند صعودی است هدر قرمز و با 🔴 نشان داده می‌شود | با توجه به `CTL` رنگ هدر را داینامیک کن |
| U3 | ردیف «کلی» | همان `overallRec` در **۵ سلول** تکرار می‌شود | یک سلول با `table.merge_cells` |
| U4 | ردیف‌های تکراری | در Gold: `Macro`/`Status`/`Regime` سه بار یک مفهوم؛ در Crypto: `Macro` و `Status` تکراری | یکی را حذف کن |
| U5 | `plot(na)` وسط کد | بی‌استفاده و گیج‌کننده | حذفش کن |
| U6 | دقت اعداد فایب | `str.tostring(_prc)` با دقت کامل → لیبل‌های بسیار بلند | `str.tostring(_prc, format.mintick)` |
| U7 | موبایل | `sizefont1` در حالت موبایل کاملاً نادیده گرفته می‌شود (همیشه `size.tiny`) | اگر هدف اندازهٔ کوچک است، خوب؛ ولی در tooltip بنویس |
| U8 | `_curBg = color.rgb(80,0,0)` | رنگ ستون «TF جاری» با تم بقیهٔ جدول (`rgb(30,20,60)`) هماهنگ نیست | هماهنگ‌سازی |

---

## ۷) ⚪ کد مرده و ورودی‌های بی‌اثر

```pine
// ❌ این چهار ورودی هیچجا استفاده نشدهاند:
s01_crypto = input.symbol('CRYPTOCAP:BTC.D',  group = 'Crypto Symbols')
s01_gold   = input.symbol('FX:EURUSD',        group = 'Gold/Forex Symbols')
s02_gold   = ... // ⚠️ استفاده میشود: _dxyVal_raw = request.security(s02_gold , ...) ✅
s03_gold   = ... // ✅ استفاده میشود (US10Y)
s04_gold   = ... // ✅ استفاده میشود (VIX)
```

* **`s01_crypto` و `s01_gold` استفاده نشده‌اند** و `s01_crypto` با `s03_crypto` **هم‌مقدار و تکراری** است. ولی جدول مقدار BTC.D را از درخواستِ **هاردکدشدهٔ** `request.security('CRYPTOCAP:BTC.D', ...)` می‌گیرد؛ یعنی حتی اگر کاربر `s01_crypto` را عوض کند، ستون `BTC.D 🔗` تغییر نمی‌کند. این یک تلهٔ UX است — یا ورودی‌ها را به درخواست‌ها وصل کن، یا حذفشان کن.
* `import LudoGH68/Drawings_public/1 as d` **هیچ‌جا استفاده نشده** → حذف کن (وابستگی به کتابخانهٔ ثالث + زمان کامپایل اضافه).
* این ورودی‌ها با `display = display.none` تعریف شده و **هیچ‌جا خوانده نمی‌شوند** (رنگ‌های جدول هاردکد شده‌اند): `screenerColor`, `frameColor`, `borderColor`, `textColorl`, `textColors`, `textColort2`.
* `aUp_cur` (و `aUp_tf*`, `ra4_tf*`) هیچ‌جا در جدول استفاده نمی‌شود → یا ستون ALT/TOTAL2 را به آن وصل کن، یا حذف کن.
* `_fvge_cur`, `_fvgbs_cur`, `_fvghb_cur`, `_h10_cur`, `_l10_cur` فقط بازمحاسبه‌ی چیزهایی هستند که بالاتر ساخته شده‌اند (تکرار محض).
* `MAX_HIST = 2000` در حالی که `_safeLeft = math.max(_left, bar_index - 500)` در OB از ۵۰۰ استفاده می‌کند — دو مقدار ناهماهنگ برای یک مفهوم.
* `bullishBosColor` و `bearishBosColor` هر دو `color.silver` هستند و در BOS/CHoCH از **رنگ‌های متفاوت** استفاده می‌شود؛ ولی در کد، BOS از `bearishBosColor`/`bullishBosColor` استفاده می‌کند که هم‌رنگ‌اند → عملاً BOS های صعودی و نزولی از هم قابل تفکیک نیستند (احتمالاً قصد نبوده).

---

## ۸) ✅ چیزهایی که بررسی کردم و **درست** هستند

*(این‌ها را نوشتم که وقتت را برای دوباره‌چک‌کردن آن‌ها تلف نکنی)*

| مورد | نتیجه |
|------|-------|
| تعداد آرگومان‌های همهٔ توابع با تعریفشان | ✅ تطابق کامل (شامل `f_computeBias` با ۲۰ آرگومان و `f_getSignalFinal` با ۱۰) |
| ترتیب پارامترهای `f_getMacroRegime` و `f_computeBias` (چهار ماکرو کریپتو / سه ماکرو طلا) | ✅ درست؛ نگاشت `_ca1=TOTAL, _ca2=BTC.D, _ca3=USDT.D, _ca4=TOTAL2` و `_ga1=DXY, _ga2=US10Y, _ga3=VIX` صحیح است |
| `box.new` برای FVG صعودی/نزولی (top > bottom) | ✅ درست |
| `ob_os`, `ob_remove_mitigated`, شرط حدف OB با `target < element` | ✅ درست |
| `plot(bull_ob, ..., offset = -ob_length)` | ✅ جهت آفست درست است |
| جهش ایندکس در `while` + `array.remove` (بدون پرش عنصر) | ✅ در همهٔ سه موتور (FVG / Liquidity / OB) درست نوشته شده |
| محدودیت اشیای گرافیکی: گذشته ۹۹۹۹ کندل، آینده ۵۰۰ کندل | ✅ `f_clampStartIdx` (۲۰۰۰) و `nn` (۳) و `_safeLeft` (۵۰۰) همه داخل محدوده‌اند |
| `label.new(na, na, na, na ...)` و box با مختصات `na` | ✅ مجاز است |
| `ta.highest(ob_length)` / `ta.lowest(ob_length)` بدون source | ✅ source پیش‌فرض `high`/`low` است |
| `v6` بودن `switch`، tuple-return، `+=` روی شمارنده‌ها | ✅ همه در v6 مجاز است |
| سقف ۱۲۷ عنصر tuple برای `request.*` | ✅ ۴۴ + ۲۸ = ۷۲، زیر سقف |
| `table.clear` با محدودهٔ درست برای Mobile(6 ردیف)/Desktop(13 ردیف) | ✅ |
| `var` بودن `tableInfo1` + بازسازی در تغییر Position/Mode | ✅ منطق درستی دارد |

---

## ۹) پچ‌های آمادهٔ اعمال (به ترتیب اولویت)

```pine
// ───── ۱) اعلان اسکریپت: یک کلمه، ۲۸ درخواست صرفهجویی ─────
indicator('Wolf M-A v4 | Crypto & Gold', overlay = true, max_bars_back = 600,
     max_lines_count = 500, max_labels_count = 500, max_boxes_count = 500,
     dynamic_requests = false)

// ───── ۲) MAX_HIST واقعبینانه ─────
MAX_HIST = 500

// ───── ۳) رفع کد مردهی Transition (در _computeConfidenceIndex) ─────
else
    _tc = ((liqSweepLow or liqSweepHigh) ? 15.0 : 0.0) +
          ((dispIsBullish or dispIsBearish) ? 12.0 : 0.0)
    _s  := 35.0 + _tc * 0.8          // بیشینه 56.6 → آستانهی 55 قابل دسترس

// ───── ۴) همان اصلاح در فایل TFها (f_getAllTFData) ─────
else if _trendFull == "Transition"
    _tcC = ((_lsl or _lsh) ? 15.0 : 0.0) + ((_dispb or _dispr) ? 12.0 : 0.0)
    _conf := math.max(0.0, math.min(100.0, math.round(35.0 + _tcC * 0.8)))

// ───── ۵) فیلتر ماکرو طلا دیگر بیاثر نباشد ─────
_dollarWeak = not dxyUp and not us10yUp
// و در f_getAllTFData:
// _dWeak_t = not _dU and not _u10U
// _macroLong_t = (_vU and _dU) or (_vU and not _dU and _u10U) or _dWeak_t

// ───── ۶) رفع رنگ خاکستری ردیفهای بازار ─────
getBoolColor(_s) =>
    str.contains(_s, "🟢") ? color.rgb(0,230,80) :
     str.contains(_s, "🔴") ? color.rgb(255,65,65) : color.rgb(160,160,180)
// استفاده: f_cellnb(1, 2, dxy_tf1, getBoolColor(dxy_tf1))

// ───── ۷) پیوت حجم برای نمادهای بدون Volume ─────
_volSrc = na(volume) ? (high - low) : volume
phv     = ta.pivothigh(_volSrc, ob_length, ob_length)

// ───── ۸) پاکسازی لیبلهای OB ─────
if barstate.islast
    for i = 0 to array.size(ob_lbl) - 1
        if i > ext_last - 1
            label.set_text(array.get(ob_lbl, i), "")

// ───── ۹) default برای switch ─────
ob_get_line_style(style) =>
    switch style
        '⎯⎯⎯' => line.style_solid
        '----' => line.style_dashed
        '····' => line.style_dotted
        =>        line.style_solid
```

**پاک‌کردن‌ها (بدون هیچ اثر رفتاری):**
`import ... as d` ، `s01_crypto` ، `s01_gold` ، `textColort2` ، `screenerColor` ، `frameColor` ، `borderColor` ، `textColorl` ، `textColors` ، `plot(na)` ، و بلوک‌های بازمحاسبهٔ `_fvge_cur/_fvgbs_cur/_fvghb_cur/_h10_cur/_l10_cur`.

---

## ۱۰) کارهای بعدی / سؤال‌های باز

1. **اگر خطای کامپایل مشخصی می‌گیری**، متن کامل خطا را بفرست؛ چیزهایی که در بازخوانی استاتیک قابل تشخیص قطعی نیستند عبارتند از وابستگی‌های `request.security` به متغیرهای `var` گلوبال و رفتار `f_safeHigh/Low` با آفست‌های داینامیک در کانتکست‌های درخواستی.
2. **تصمیم طراحی لازم برای C4**: آیا می‌خواهی فیلتر ماکرو در حالت Gold واقعاً فیلتر کند (و سیگنال‌ها کمتر شوند) یا این نرمی عمدی است؟ عدد را باید با بک‌تست انتخاب کنی، نه سلیقه.
3. **کالیبراسیون آستانه‌ها**: `_spreadScore (±6/12/20/30)`، `_net (28/52)`، `confidenceIndex (55/60)`، `breakQualityThresh (0.3)` — این پنج عدد کل رفتار سیگنال را تعیین می‌کنند و هیچ‌کدام مستند/کالیبره نشده‌اند. یک جدول حساسیت (Sensitivity) بگیر.
4. **یکدست‌سازی قاعده‌ها**: الان قاعدهٔ «هم‌جهتی ماکرو» دو بار نوشته شده (یک‌بار برای TF جاری، یک‌بار در `f_getAllTFData`) و همان‌طور که دیدیم هر دو از یک باگ رنج می‌برند. یک تابع مشترک `f_macroAllows(isGold, ...)` بساز و همه‌جا از آن استفاده کن؛ این تنها راه جلوگیری از drift در آینده است.
5. **تست سناریومی**: ۱) چارت ۱ دقیقه با TFها ۳/۵/۱۵/۱D — ۲) نمودار طلا با همان TFها — ۳) نماد بدون Volume — ۴) بک‌تست سریع کندل‌به‌کندل با `barstate.isrealtime` برای مشاهدهٔ رفتار ری‌پینت ستون‌ها.

---

### ضمیمه: مراجع مستندات استفاده‌شده
* Pine Docs — *Other timeframes and data*: «Declared variables» (تکرار کدِ وابستگی‌ها)، «Nested requests» (ارث‌بری کانتکست)، «Historical and realtime behavior» (ری‌پینت مقادیر HTF)، «Dynamic requests» (رفتار `dynamic_requests = false`).
* Pine Docs — *request.security()* / محدودیت ۴۰ درخواست یکتا در هر اجرا.
* TradingView — محدودهٔ مختصات اشیای گرافیکی با `xloc.bar_index`: گذشته ۹۹۹۹ کندل، آینده ۵۰۰ کندل.
* TradingView — دلایل خطای حافظه `RE10139` (از جمله `max_bars_back` بیش از نیاز و به‌روزرسانی‌های غیرضروری اشیا).
