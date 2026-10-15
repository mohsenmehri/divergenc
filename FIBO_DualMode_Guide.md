# Wolf M-A v4.2 — راهنمای دو حالتهٔ لنگر فیبوناچی (Dual Fibonacci Anchor)

> **درخواست کاربر:** «دو حالتش بزار و کاربر انتخاب کنه» — هر دو منطقِ دقیق‌سازیِ فیبو پیاده و قابل انتخاب از منوی تنظیمات شد.

---

## ۱. مشکلِ اصلی در v4.1 چه بود؟

| بخش | باگ v4.1 | اثر روی فیبوناچی |
|-----|----------|-----------------|
| **ابتدای فیبو** (`structureLow` هنگام شکست سقف / `structureHigh` هنگام شکست کف) | `Len = 25` ثابت از گروه *Fear Value Gap* برای جستجوی سقف/کف استفاده می‌شد (`get_structure_highest_bar(Len)`). اگر طول لگ >۲۵ کندل بود کف/سقف اصلی بیرون می‌ماند؛ اگر <۲۵ بود، محدوده به لگ قبلی نشت می‌کرد. | ابتدای فیبو وسطِ موج یا داخل لگ قبلی می‌افتاد |
| **`get_structure_*` با فراکتال سه‌کندلی** | شرط `high[i+1] > high[i+2] and high[i] <= high[i+1]` سقف‌های دوقلو (`Equal High`) و سقفی که دقیقا روی `maxBar` بود را رد می‌کرد و یک قلهٔ کوچکِ بعدی را برمی‌گرداند | انتخاب قلهٔ اشتباه به‌عنوان 0 یا 1 فیبو |
| **انتهای فیبو** (`f_canChaseStructure` با `structChaseBars = 3`) | پس از ۳ کندل، `high > structureHigh` (شدو) دیگر دنبال نمی‌شد؛ و اگر شدو بدون کلوزِ بدنه زده می‌شد، نه `Chase` فعال بود نه `BOS` → انتهای فیبو روی کندلِ قبلی قفل می‌ماند | نوکِ واقعیِ موج (سوییپ با شدو) گرفته نمی‌شد |
| **شکست‌های کاذبِ میانهٔ لگ** | یک مکثِ کوچکِ ۲–۳ کندلی که بدنه بالای سقف قبلی می‌بست، به‌عنوان BOS جدید، `structureLow` را از کفِ اصلی به کفِ مکث منتقل می‌کرد | ابتدای فیبو از کف اصلی جدا و وسط راه می‌افتاد |

---

## ۲. راه‌حل v4.2 — بازهٔ پویا + دو حالتِ تعقیب

### ۲.۱ ابتدای فیبو: بازهٔ پویا (هر دو حالت مشترک)
```pinescript
_spanForHigh = structureLowStartIndex  <= 0 ? Len : f_spanFrom(structureLowStartIndex)   // = bar_index - structureLowStartIndex + 1
_spanForLow  = structureHighStartIndex <= 0 ? Len : f_spanFrom(structureHighStartIndex)
structureMaxBar = bar_index + get_structure_highest_bar(_spanForHigh)  // بالاترین high بین کفِ قبلی تا شکست فعلی
structureMinBar = bar_index + get_structure_lowest_bar(_spanForLow)   // پایین‌ترین low  بین سقفِ قبلی تا شکست فعلی
```
- وقتی سقف می‌شکند، کفِ شروع موج دقیقاً **پایین‌ترین low بین `structureHighStartIndex` تا `bar_index`** است.
- وقتی کف می‌شکند، سقفِ شروع موج دقیقاً **بالاترین high بین `structureLowStartIndex` تا `bar_index`** است.
- `f_spanFrom()` تا `MAX_HIST (500)` محدود شده و در ابتدای چارت به‌صورت خودکار به `Len` فالبک می‌کند.
- تابع `get_structure_*` اصلاح شد: حلقهٔ فراکتال حذف و مستقیماً `ta.highestbars / lowestbars` برگردانده می‌شود → سقف/کف‌های دوقلو و Equal High/Low درست پوشش داده می‌شوند.

همین اصلاح در موتور TF (`f_tfState`) هم اعمال شد (`_spanForHigh_tf` / `_spanForLow_tf`).

### ۲.۲ انتهای فیبو: دو حالتِ انتخابی

در گروه **Structure Fibonacci** سه ورودی جدید اضافه شد:

| ورودی | نوع | توضیح |
|------|-----|-------|
| **حالت لنگر فیبوناچی** | `Wick-to-Wick (کلاسیک)` / `Pivot Locked (پیوت)` | انتخاب منطق انتهای فیبو |
| **طول پیوت** | ۱..۱۰ (پیش‌فرض ۲) | فقط در حالت پیوت: تعداد کندل تأیید هر طرف پیوت (`ta.pivothigh/low`) |
| **دنبال‌کردن شدو بدون محدودیت (کلاسیک)** | bool (پیش‌فرض ✅) | فقط در حالت کلاسیک: اگر روشن باشد، حتی پس از ده‌ها کندل، هر شدوی جدید انتها را جابجا می‌کند |

#### حالت ۱: `Wick-to-Wick (کلاسیک)` — پرایس‌اکشن خالص، دقیق‌ترین نوکِ موج
- **ابتدا:** بازهٔ پویا (مشترک)
- **انتها:** هر `high > structureHigh` در لگ صعودی (و هر `low < structureLow` در لگ نزولی) **بدون محدودیتِ `structChaseBars`** انتها را به‌روز می‌کند — حتی اگر ۲۰ کندل از شروع ساق گذشته باشد و فقط با شدو سقفِ جدیدی زده شود، انتهای فیبو دقیقاً روی نوکِ شدو می‌نشیند.
- مناسب برای: اسکلپرها، طلا/کریپتو با سوییپ‌های شدویی، کسانی که می‌خواهند اصلاح از **نقطهٔ دقیقِ برگشت** سنجیده شود.
- اگر تیکِ «دنبال‌کردن بدون محدودیت» خاموش شود، رفتار به `structChaseBars` محدود می‌شود (سازگار با تنظیمات قدیمی).

```pinescript
// ساده‌شده
if isClassicMode and fibWickTrailClassic
    canChaseHigh := true   // هر شدوی بالاتر
else
    canChaseHigh := f_canChaseStructure(startIdx)
```

#### حالت ۲: `Pivot Locked (پیوت)` — فیلتر نویز داخل پولبک
- **ابتدا:** بازهٔ پویا (مشترک)
- **انتها:** تا قبل از تشکیل **پیوت تأییدشده** (`ta.pivothigh/low` با طول انتخابی) و تا پایانِ `structChaseBars`، شدوها تعقیب می‌شوند؛ به‌محض اینکه:
  - یک `pivothigh` تأیید شد (یعنی سقفِ محلی با `fibPivotLen` کندل تأیید در هر طرف) → `structureHighLocked := true`
  - یا یک `pivotlow` تأیید شد → `structureLowLocked := true`
  - یا در لگ صعودی یک `pivotlow` دیده شد (شروعِ پولبک) → سقفِ بالا قفل می‌شود (و برعکس)
  
  انتهای فیبو **قفل** می‌شود و تغییراتِ کوچکِ بعدی داخلِ پولبک نادیده گرفته می‌شود تا فیبو «نلرزد».

- پس از **شکستِ مخالف** (`BOS/CHoCH`) هر دو قفل ریست می‌شوند.
- اگر قبل از قفل، شدوی بالاتری زده شود، قفل باز می‌شود (`structureHighLocked := false`) و دوباره تعقیب ادامه می‌یابد.

```pinescript
bool pivotHighNow = not na(ta.pivothigh(high, fibPivotLen, fibPivotLen))
bool pivotLowNow  = not na(ta.pivotlow(low, fibPivotLen, fibPivotLen))
if not isClassicMode
    if structureDirection == 2 and pivotHighNow
        structureHighLocked := true
    if structureDirection == 1 and pivotLowNow
        structureLowLocked := true
    // ...
    canChaseHigh := not structureHighLocked and f_canChaseStructure(startIdx)
```

- مناسب برای: سوئینگ‌تریدرها، تایم‌فریم‌های بالاتر، بازارهای رِنج که سایه‌های کوچک نباید فیبو را جابجا کنند.

---

## ۳. کجا تنظیم کنیم؟

TradingView → تنظیمات اندیکاتور → گروه **Structure Fibonacci**:
1. `حالت لنگر فیبوناچی` را انتخاب کنید.
2. اگر `Pivot Locked` را انتخاب کردید، `طول پیوت` را (معمولاً ۲ برای اسکلپ، ۳–۵ برای سوئینگ) تنظیم کنید.
3. اگر `Wick-to-Wick` را انتخاب کردید و می‌خواهید رفتار قدیمیِ ۳-کندلی حفظ شود، تیکِ سوم را خاموش کنید.

> **نکته:** `Structure Chase Bars` (گروه Structures) در هر دو حالت همچنان مؤثر است؛ در حالت کلاسیک با تیکِ سومِ روشن نادیده گرفته می‌شود.

---

## ۴. فهرست تغییراتِ کد (برای توسعه‌دهنده)

| فایل / بخش | تغییر |
|-----------|-------|
| `indicator()` | نسخه به `v4.2 — Dual Fibo` ارتقا یافت |
| `nn` | سه ورودیِ جدید `fibAnchorMode`, `fibPivotLen`, `fibWickTrailClassic` اضافه شد |
| `get_structure_highest/lowest_bar()` | حذف حلقهٔ فراکتال؛ مستقیم `ta.highestbars/lowestbars` |
| `f_spanFrom()` | تابع کمکی جدید برای محاسبهٔ بازهٔ پویا |
| `f_tfState` | `_sMaxBar/_sMinBar` پویا + `canChase*TF` دو حالته |
| `STRUCTURE ENGINE` (چارت) | متغیرهای `structureHigh/LowLocked` + بازهٔ پویا + منطقِ دو حالتهٔ تعقیب با `ta.pivothigh/low` |
| `FIBONACCI DRAW ENGINE` | بدون تغییر منطقی؛ `calcFib()` و `f_drawFiboLines()` اکنون از لنگرهای دقیق استفاده می‌کنند |

---

## ۵. تستِ پیشنهادی

1. **لگِ بلند (>۲۵ کندل):** در حالت کلاسیک، ابتدای فیبو باید دقیقاً کفِ شروعِ همان لگ باشد، نه ۲۵ کندل قبل.
2. **سوییپ با شدو بعد از ۴ کندل درجا:** در حالت کلاسیک با تیکِ روشن، انتهای فیبو باید به نوکِ شدو بپرد؛ در حالت پیوت باید قفل بماند اگر پیوت تأیید شده باشد.
3. **Equal High (سقف دوقلو):** سقفِ دقیق (نه قلهٔ فرعیِ بعدی) به‌عنوان ۱ فیبو انتخاب شود.
4. **پولبک بدون شکست:** در حالت پیوت با `fibPivotLen=2`، پس از تشکیل پیوتِ ۲-۲، فیبو دیگر با نوساناتِ کوچک جابجا نشود.

---

## ۶. نصب

1. فایل `Wolf_MA_v4.2_DualFibo.pine` را در TradingView → Pine Editor کپی کنید.
2. `Save` → `Add to Chart` .
3. از منوی تنظیمات، حالتِ دلخواه را انتخاب کنید.

فایل اصلی v4.1 بدون تغییر در `Wolf_MA_v4.2_DualFibo.pine` نگهداری شده تا مقایسه آسان باشد.
