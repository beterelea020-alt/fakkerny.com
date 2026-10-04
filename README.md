# فَكّرني — Turso Full‑Stack Edition

فَكّرني الآن ليس مجرد Frontend. المشروع صار **PWA + Vercel Serverless API + Turso/libSQL** مع حسابات ومزامنة ولوحة إدارة وحدود حماية للموارد.

## لماذا Turso؟

تم اختيار Turso بدل Supabase لأن الخطة المجانية الحالية تمنح المشروع:

- 5GB تخزين.
- 500 مليون قراءة صفوف شهريًا.
- 10 ملايين كتابة صفوف شهريًا.
- 100 قاعدة بيانات.
- بدون الحاجة إلى بطاقة ائتمانية للبدء.

المشروع يستخدم **قاعدة Turso واحدة فقط** لتخزين:

- حسابات المستخدمين والجلسات.
- بيانات التطبيق السحابية.
- البلاغات والاقتراحات.
- اشتراكات Push والجداول المجدولة لها.
- سجلات إجراءات الإدارة.

مصدر الحقيقة المحلي ما زال `localStorage`، لذلك التطبيق يظل قابلًا للاستخدام Offline.

## ماذا تمت إضافته؟

### الحسابات

- إنشاء حساب.
- تسجيل الدخول والخروج.
- جلسات آمنة داخل `HttpOnly` cookie.
- كلمات المرور لا تُحفظ كنص واضح؛ يتم تحويلها إلى hash باستخدام `scrypt` من Node.
- إيقاف الحساب يلغي جلساته مباشرة.

### المزامنة

المزامنة **اختيارية** وليست شرطًا لاستخدام التطبيق.

عند تسجيل الدخول:

- لو الحساب جديد ولا توجد نسخة سحابية: يرفع نسخة جهازك.
- لو توجد نسخة سحابية فقط: ينزلها إلى الجهاز.
- لو النسختان تغيرتا معًا: تظهر شاشة اختيار بدل حذف إحدى النسختين بصمت.
- بعد ذلك يتم رفع التغييرات تلقائيًا مع debounce للحفاظ على الحصة المجانية.

### لوحة الإدارة

للمستخدم الذي يحمل `role = admin`:

- عدد الحسابات.
- الحسابات النشطة والموقوفة.
- عدد المديرين والجلسات.
- حجم البيانات المخزنة.
- نسبة الاستخدام من الحد الآمن للمشروع.
- قائمة المستخدمين.
- إيقاف/تفعيل حساب.
- إعطاء/إزالة صلاحية المدير.
- حذف بيانات مستخدم مع الإبقاء على حسابه.
- رؤية البلاغات والاقتراحات وإغلاقها.
- سجل إجراءات الإدارة في قاعدة البيانات.

### الحدود المجانية داخل التطبيق

حدود Turso نفسها هي الحد الأعلى للخدمة، لكن المشروع يضع **Safety Limit** قبل الوصول لها حتى لا يتم استنزاف المجاني فجأة.

الإعدادات الافتراضية:

- 1000 حساب.
- 5MB كحد لحجم بيانات مستخدم واحد.
- 4.5GiB كحد آمن إجمالي لبيانات التطبيق، مع ترك هامش لـTurso وباقي الجداول.
- مزامنة واحدة على الأكثر كل 10 ثوانٍ للمستخدم العادي.

كل هذه القيم قابلة للتعديل من Environment Variables.

## الملفات المهمة

```text
api/
├── auth/
│   ├── login.js
│   ├── logout.js
│   ├── me.js
│   └── register.js
├── admin/
│   ├── action.js
│   ├── feedback.js
│   ├── stats.js
│   └── users.js
├── cron/
│   └── check-due.js
├── lib/
│   ├── auth.js
│   ├── db.js
│   ├── limits.js
│   ├── push.js
│   └── store.js
├── data.js
├── feedback.js
├── health.js
└── usage.js

js/features/
├── cloud.js
├── feedback.js
└── push-sync.js

js/storage/
└── db.js

scripts/
└── make-admin.mjs

.env.example
```

## 1) إنشاء Turso

من حساب Turso أنشئ Database جديدة، ثم خذ:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

والـCLI الحالي يوفر أيضًا أوامر من نوع:

```bash
turso db show --url <database-name>
turso db tokens create <database-name>
```

## 2) إنشاء الجداول

افتح SQL Editor داخل Turso وشغّل الملف:

```text
api/lib/schema.sql
```

أو نفّذ SQL نفسه من أي عميل Turso موثوق.

## 3) Environment Variables في Vercel

أضف:

```text
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...

VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=...

FREE_MAX_USERS=1000
FREE_MAX_USER_DATA_BYTES=5242880
FREE_MAX_TOTAL_DATA_BYTES=4831838208
FREE_MIN_SYNC_INTERVAL_MS=10000
```

`TURSO_AUTH_TOKEN` و`VAPID_PRIVATE_KEY` أسرار ولا يجب وضعهما داخل ملفات JavaScript التي تصل للمتصفح.

## 4) تشغيل محليًا

```powershell
npm install
py -m http.server 8080
```

ثم:

```text
http://localhost:8080
```

المشروع Static Frontend، لذلك `python -m http.server` يكفي لفتح الواجهة، لكن الـAPI الحقيقي يحتاج Deployment على Vercel أو تشغيل Vercel Functions محليًا.

للتجربة الحقيقية للـAPI محليًا، استخدم Vercel CLI:

```powershell
npm i -g vercel
vercel dev
```

## 5) عمل أول Admin

أنشئ حسابًا من الموقع أولًا.

بعدها على جهازك:

```powershell
$env:TURSO_DATABASE_URL="libsql://YOUR-DB-YOUR-ORG.turso.io"
$env:TURSO_AUTH_TOKEN="YOUR_TOKEN"
npm run make-admin -- your@email.com
```

أو نفّذ SQL مباشرًا في Turso:

```sql
UPDATE users
SET role = 'admin'
WHERE email = 'your@email.com';
```

## 6) اختبار الـBackend

بعد النشر:

```text
https://YOUR-DOMAIN.vercel.app/api/health
```

المفترض يرجع:

```json
{
  "ok": true,
  "database": "turso"
}
```

## 7) الـPush والإشعارات

بيانات Push لم تعد تعتمد على Redis/Upstash؛ أصبحت في نفس Turso Database.

المسارات الحالية:

```text
/api/subscribe
/api/unsubscribe
/api/sync-schedule
/api/cron/check-due
```

لكن لاحظ نقطة مهمة جدًا: **Vercel Hobby لا يسمح بجدولة Cron أكثر من مرة يوميًا**. لذلك الكود يظل صالحًا على الخطة المجانية، لكن الإشعارات التي تحتاج Cron server-side لن تكون دقيقة كل دقيقة على Hobby. الإشعارات داخل التطبيق نفسها تستمر بالعمل، أما الدقة العالية للـCron فتحتاج خطة تسمح بتكرار أكبر. 

## 8) الخصوصية والأمان

الواجهة لا تتصل مباشرة بـTurso.

المسار هو:

```text
Browser
   ↓ HTTPS + HttpOnly Session Cookie
Vercel Serverless API
   ↓ Bearer Token (سري)
Turso
```

ده مهم لأن `TURSO_AUTH_TOKEN` لا يخرج إلى المتصفح.

كمان كل عملية Data API تعتمد على `user_id` الموجود في الجلسة، وليس قيمة يرسلها المستخدم، لمنع تبديل `userId` للوصول إلى حساب آخر.

## 9) نقل المشروع من Supabase

لا يوجد اعتماد على Supabase في النسخة الحالية.

المطلوب في المشروع المنشور:

1. حذف أي Environment Variables قديمة خاصة بـSupabase.
2. إضافة متغيرات Turso الموجودة في `.env.example`.
3. تشغيل `api/lib/schema.sql` على Turso.
4. عمل Deploy جديد على Vercel.
5. تسجيل حساب وتجربته.
6. ترقيته إلى Admin.
7. فتح الإعدادات والتأكد من ظهور حالة الحساب والمزامنة.
8. فتح لوحة الإدارة وتجربة مستخدم تجريبي ثم إيقافه وتفعيله.

## 10) فحص الملفات

```powershell
npm run check
```

أو يدويًا:

```powershell
node --check js/app.js
```

## ملاحظة مهمة

هذه النسخة **لا تدّعي أن المشروع صار منتجًا تجاريًا نهائيًا بمجرد إضافة Database**. الأساس Full‑Stack أصبح موجودًا الآن، وبعده يمكن إضافة طبقات أكبر مثل:

- استعادة كلمة المرور بالبريد.
- حذف الحساب نهائيًا.
- 2FA.
- إدارة أجهزة المستخدم.
- تحليلات الاستخدام.
- نظام خطط Free/Pro داخل المنتج نفسه.
- Rate limiting أقوى ضد البوتات.
- Audit Log قابل للبحث والتصفية.
- لوحة Admin منفصلة على مسار مستقل.
