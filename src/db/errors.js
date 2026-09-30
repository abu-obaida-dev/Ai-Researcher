/**
 * أدوات مساعدة لتوضيح أخطاء PostgreSQL وتحويلها إلى رسائل قابلة للتنفيذ.
 * تُستخدم في سكربتات التهيئة (init) والبيانات التجريبية (seed).
 */

/** يحلّل DATABASE_URL ويعيد تفاصيل الاتصال مع اسم قاعدة البيانات الهدف. */
export function resolveDatabaseTarget(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL غير معرّف. انسخ ملف .env.example إلى .env ثم عدّل قيمة DATABASE_URL.'
    );
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(
      `DATABASE_URL غير صالح: ${connectionString}\nالصيغة الصحيحة: postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
    );
  }

  return {
    connectionString: url.toString(),
    host: url.hostname || 'localhost',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'postgres'),
    database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'ai_researcher')
  };
}

/** يبني رابط اتصال بقاعدة الصيانة postgres — تُستخدم لإنشاء قاعدة البيانات إن لم تكن موجودة. */
export function adminConnectionString(connectionString) {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

/** يحوّل خطأ الاتصال أو الاستعلام إلى رسالة عربية واضحة مع خطوات الحل. */
export function describeDatabaseError(error, target, action) {
  const code = error?.code;
  const where = target ? ` على ${target.host}:${target.port}/${target.database}` : '';
  const lines = [`فشل ${action}${where}.`];

  switch (code) {
    case 'ECONNREFUSED':
      lines.push('لا يوجد خادم PostgreSQL يعمل على هذا العنوان. شغّل قاعدة البيانات بأحد الخيارات:');
      lines.push('  1) عبر Docker:   npm run db:up');
      lines.push('  2) محلياً:        sudo service postgresql start');
      lines.push('  3) قاعدة مستضافة (Neon / Supabase / Railway): حدّث DATABASE_URL في .env.');
      break;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      lines.push('اسم المضيف في DATABASE_URL غير صحيح أو لا يوجد اتصال بالشبكة.');
      break;
    case '28P01':
      lines.push('كلمة مرور مستخدم قاعدة البيانات غير صحيحة — صحّح USER و PASSWORD في DATABASE_URL.');
      break;
    case '3D000':
      lines.push('قاعدة البيانات غير موجودة. أنشئها يدوياً (createdb) أو استخدم مستخدماً يملك صلاحية CREATEDB، ثم أعد تشغيل npm run db:init.');
      break;
    case '28000':
      lines.push('المستخدم غير موجود أو غير مسموح له بالاتصال (راجع pg_hba.conf في PostgreSQL).');
      break;
    case '42501':
      lines.push('الصلاحيات غير كافية (مثل إنشاء قاعدة بيانات أو extension). استخدم مستخدماً بصلاحية superuser أو CREATEDB.');
      break;
    default:
      lines.push(`تفاصيل الخطأ: ${error?.message || 'خطأ غير معروف'}`);
  }

  return lines.join('\n');
}

/** تلميح إرشادي موجز حسب كود خطأ PostgreSQL — يُستخدم في مسارات الـ API وصفحات الإدارة. */
export function hintForDatabaseError(error) {
  switch (error?.code) {
    case 'ECONNREFUSED':
      return 'لا يوجد خادم PostgreSQL يعمل — شغّله عبر npm run db:up أو sudo service postgresql start.';
    case '3D000':
      return 'قاعدة البيانات غير موجودة — شغّل npm run db:init.';
    case '42P01':
      return 'الجداول غير موجودة بعد — شغّل npm run db:init ثم npm run db:seed.';
    case '42703':
      return 'مخطط قاعدة البيانات قديم (أعمدة ناقصة) — شغّل npm run db:init لتحديثه.';
    case '28P01':
      return 'كلمة مرور المستخدم غير صحيحة — صحّح DATABASE_URL في .env.';
    default:
      return 'تأكد من تشغيل PostgreSQL ومن صحة DATABASE_URL في .env.';
  }
}
