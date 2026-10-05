import {
  APP_NAME,
  DEGREE_LEVELS,
  GOAL_OPTIONS,
  PLATFORM_SERVICES,
  PROGRESS_LEVELS,
  RESEARCH_STAGES,
  SPECIALIZATIONS,
  TOKEN_COSTS
} from '../constants.js';
import { formatDate, formatDateTime, formatNumber } from './format.js';
import { formatStorageMb } from '../services/plans.js';
import { googleIcon, icon } from './icons.js';
import { BRAND, escapeHtml, renderLayout } from './layout.js';

/** اسم الخدمة بالعربية من مفتاحها (لعرض خدمات الباقة في اللوحة والحساب). */
function serviceLabel(key) {
  return PLATFORM_SERVICES.find((service) => service.key === key)?.short || key;
}

/**
 * صفحات المصادقة والحساب: الدخول بحساب جوجل، إكمال الملف البحثي (onboarding)،
 * وصفحة الحساب — كلها HTML مولَّد على الخادم بدون React، وكل البيانات في PostgreSQL.
 */

/** مزايا التسجيل المعروضة في لوحة الدخول — الرصيد المجاني من الباقة المجانية */
function buildBenefits(freeTokens) {
  return [
    { icon: 'coins', text: `${formatNumber(freeTokens)} نقطة مجاناً بمجرد التسجيل` },
    { icon: 'graduation', text: 'ملف بحثي مخصص حسب مجالك وجامعتك' },
    { icon: 'shield', text: 'دخول آمن بحساب جوجل بدون كلمات مرور' }
  ];
}

/** أيقونة بديلة للحساب: الصورة إن وُجدت أو الحرف الأول من الاسم. */
function renderAvatar(account) {
  if (account.photo_url) {
    return `<img class="avatar" src="${escapeHtml(account.photo_url)}" alt="" width="58" height="58" referrerpolicy="no-referrer" />`;
  }
  const initial = (account.full_name || account.email || '؟').trim().charAt(0);
  return `<span class="avatar">${escapeHtml(initial)}</span>`;
}

/**
 * وصف كل نوع من أنواع الاستهلاك: تسمية عربية + أيقونة.
 * الأنواع الخمسة تأتي من TOKEN_COSTS (تسعير الخدمات)، ونوعٌ إضافي واحد
 * يسجّله services/chat.js عند فشل المزوّدين (لا يُخصم منه شيء).
 */
const USAGE_META = {
  chat: { label: 'رسالة للمشرف الذكي', icon: 'message' },
  translate: { label: 'ترجمة وصياغة أكاديمية', icon: 'language' },
  outline: { label: 'خطة وهيكل بحث', icon: 'list' },
  sources: { label: 'اقتراح مصادر ومراجع', icon: 'book' },
  review: { label: 'مراجعة فصل أو مقطع', icon: 'searchCheck' },
  chat_failed: { label: 'رسالة فشلت (لم يُخصم رصيد)', icon: 'refresh' }
};

/** تسمية عربية لنوع عملية الاستهلاك (مع اسم مزوّد الذكاء الاصطناعي للأنواع التقنية). */
function usageLabel(type) {
  const known = TOKEN_COSTS.find((item) => item.type === type);
  if (known) return known.label;
  return USAGE_META[type]?.label || 'عملية أخرى';
}

/**
 * تنظيف الملخص المخزَّن: هو يخلط نص المستخدم بتفاصيل تقنية للمزوّد
 * («سؤالي · model=gemini-3.8-flash · provider=gemini») — نُبقي على النص المفيد فقط.
 */
function cleanUsageSummary(summary) {
  return String(summary || '')
    .split('·')
    .map((part) => part.trim())
    .filter((part) => part && !/^(model|provider)\s*=/i.test(part))
    .join(' — ');
}

/**
 * سجل الاستهلاك في صورة قائمة بطاقات مضغوطة بدل جدول عريض:
 * كل عملية = سطر واحد (النوع + الملخص) مع النقاط والتاريخ على الطرف الآخر.
 */
function renderUsageList(rows) {
  if (!rows.length) {
    return '<div class="empty">لا توجد عمليات استهلاك بعد — ابدأ محادثة مع المشرف الذكي.</div>';
  }

  return `<ul class="usage-list">${rows
    .map((row) => {
      const meta = USAGE_META[row.type] || { label: usageLabel(row.type), icon: 'coin' };
      const summary = cleanUsageSummary(row.summary);
      const failed = row.type === 'chat_failed';

      return `<li class="usage-item${failed ? ' is-failed' : ''}">
  <span class="usage-icon">${icon(meta.icon, 'icon-sm')}</span>
  <div class="usage-main">
    <b>${escapeHtml(meta.label)}</b>
    ${summary ? `<p class="usage-summary">${escapeHtml(summary)}</p>` : ''}
  </div>
  <div class="usage-side">
    <span class="usage-tokens">${failed ? '—' : `−${escapeHtml(formatNumber(row.tokens_used))}`}</span>
    <span class="usage-time">${escapeHtml(formatDateTime(row.created_at))}</span>
  </div>
</li>`;
    })
    .join('')}</ul>`;
}

/** صفحة الدخول: لوحة تعريفية كحلية + زر «المتابعة بحساب جوجل». */
export function renderLoginPage({ freeTokens, error = '', next = '', googleReady = true, account = null }) {
  const benefits = buildBenefits(freeTokens)
    .map((benefit) => `<li><span class="feature-icon">${icon(benefit.icon, 'icon-sm')}</span>${escapeHtml(benefit.text)}</li>`)
    .join('');

  // بعد الدخول نرجع الزائر للمسار الذي طلبه (إن كان داخلياً)
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : '';

  const action = googleReady
    ? `<a class="google-btn" href="/auth/google${nextQuery}">${googleIcon()} المتابعة باستخدام حساب جوجل</a>`
    : `<div class="alert">
        <b>تفعيل الدخول بحساب جوجل مطلوب:</b>
        أضف <code>GOOGLE_CLIENT_ID</code> و<code>GOOGLE_CLIENT_SECRET</code> في ملف <code>.env</code>
        من Google Cloud Console، وسجّل عنوان العودة
        <code>/auth/google/callback</code>، ثم أعد تشغيل الخادم.
      </div>`;

  const body = `
<div class="auth-split">
  <aside class="auth-aside">
    <span class="aside-brand">
      <img src="${BRAND.icon}" alt="" width="30" height="30" />
      <span>${escapeHtml(APP_NAME)}</span>
    </span>
    <div class="aside-copy">
      <h2>ابدأ رحلتك البحثية<br />مع مشرف ذكي يفهم مجالك</h2>
      <ul class="auth-benefits">${benefits}</ul>
    </div>
    <small>المنصة أداة مساعدة للباحث ولا تُغني عن إشراف الأستاذ المشرف.</small>
  </aside>

  <div class="auth-form-side">
    <div class="auth-card">
      <h1>تسجيل الدخول</h1>
      <p class="lead">سجّل بحساب جوجل بضغطة واحدة — بدون كتابة بريد أو انتظار رسالة تأكيد.</p>
      ${error ? `<div class="alert">${escapeHtml(error)}</div>` : ''}
      ${action}
      <p class="auth-note">
        بالمتابعة أنت توافق على شروط الاستخدام وسياسة الخصوصية، ويحصل حسابك الجديد على
        ${escapeHtml(formatNumber(freeTokens))} نقطة مجاناً.
      </p>
      <div class="auth-links"><a href="/">العودة إلى الصفحة الرئيسية</a></div>
    </div>
  </div>
</div>`;

  return renderLayout({ title: 'تسجيل الدخول', area: 'auth', pageHead: false, account, body });
}

/** أزرار اختيار (راديو) بنفس أسلوب خطوة التسجيل في النسخة القديمة. */
function choiceGrid(name, options, selected) {
  return `<div class="choices">${options
    .map(
      (option) => `<label class="choice">
  <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${
        option.value === selected ? ' checked' : ''
      } />
  <span>${escapeHtml(option.label)}</span>
</label>`
    )
    .join('')}</div>`;
}

/** أسباب وأهمية إكمال الملف البحثي — العمود الجانبي في صفحة التسجيل. */
const ONBOARDING_REASONS = [
  {
    icon: 'bulb',
    title: 'إجابات مبنية على مجالك',
    text: 'يعرف المشرف الذكي تخصصك ومنهجيتك، فيقترح عليك مراجع وأساليب مناسبة لمجالك بالتحديد.'
  },
  {
    icon: 'graduation',
    title: 'مستوى علمي مناسب',
    text: 'تختلف احتياجات طالب البكالوريوس عن باحث الدكتوراه، لذلك نُخصّص عمق الإشراف حسب مرحلتك.'
  },
  {
    icon: 'shield',
    title: 'بياناتك محفوظة عندنا',
    text: 'بياناتك تُحفظ في خوادم المنصة وتُستخدم لتخصيص الإشراف فقط، ويمكنك تعديلها في أي وقت.'
  }
];

/** صفحة إكمال الملف البحثي (خطوة واحدة بعد أول تسجيل دخول، وتُستخدم أيضاً للتعديل). */
export function renderOnboardingPage({ account, values, errors = [], profile = null }) {
  const reasons = ONBOARDING_REASONS.map(
    (reason) => `<div class="feature-card">
  <span class="feature-icon">${icon(reason.icon)}</span>
  <h3>${escapeHtml(reason.title)}</h3>
  <p>${escapeHtml(reason.text)}</p>
</div>`
  ).join('');

  const errorBox = errors.length
    ? `<div class="alert"><b>تحقّق من البيانات:</b><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>`
    : '';

  const body = `<div class="onboarding-grid">
  <div>
    <form class="form-card" method="post" action="/onboarding">
      ${errorBox}

      <section class="form-section first">
        <h2>ما هي مرحلتك الأكاديمية؟</h2>
        <p class="form-hint">تُستخدم لضبط عمق الإشراف ومستوى المراجع المقترحة.</p>
        ${choiceGrid('degree_level', DEGREE_LEVELS, values.degree_level)}
      </section>

      <section class="form-section">
        <h2>ما هو تخصصك الأكاديمي؟</h2>
        ${choiceGrid('research_field', SPECIALIZATIONS.map((item) => ({ value: item, label: item })), values.research_field)}
        <div class="field">
          <label for="custom_field">اكتب تخصصك (إن اخترت «أخرى»)</label>
          <input type="text" id="custom_field" name="custom_field" value="${escapeHtml(values.custom_field)}" placeholder="مثال: القانون الدولي" />
        </div>
      </section>

      <section class="form-section">
        <h2>ما الذي تريد إنجازه الآن؟</h2>
        ${choiceGrid('research_stage', GOAL_OPTIONS, values.research_stage)}
      </section>

      <section class="form-section">
        <h2>أين وصلت في مشروعك البحثي؟</h2>
        ${choiceGrid('progress_stage', PROGRESS_LEVELS, values.progress_stage)}
      </section>

      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${profile ? 'حفظ التعديلات' : 'ابدأ مع المشرف الذكي'}</button>
        <span class="muted">يُحفظ الملف في خوادم المنصة ويمكنك تعديله في أي وقت.</span>
      </div>
    </form>
  </div>

  <aside class="onboarding-aside">${reasons}</aside>
</div>`;

  return renderLayout({
    title: profile ? 'ملفي البحثي' : 'أكمل ملفك البحثي',
    subtitle: 'خطوة واحدة لتخصيص إشراف المشرف الذكي لمجالك ومرحلتك',
    area: 'app',
    activeKey: 'onboarding',
    account,
    unread: 0,
    scripts: ['/js/app-shell.js'],
    pageHead: !account,
    body
  });
}

/** صف بيانات واحد في بطاقات الحساب. */
function kv(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`;
}

/** يقرأ التسمية العربية لقيمة محفوظة (مرحلة/لغة/توثيق). */
function labelOf(options, value) {
  return options.find((option) => option.value === value)?.label || value || '';
}

/** بطاقة ملخص الملف البحثي — تُستخدم في الحساب والإحصائية (لا شيء إن لم يُكمل الملف). */
function profileSummary(profile) {
  if (!profile) {
    return '<div class="empty">لم تُكمل ملفك البحثي بعد — أكمله ليخصّص المشرف الذكي إشرافه لك.</div>';
  }

  const stageLabel =
    RESEARCH_STAGES.find((item) => item.value === profile.research_stage)?.label || profile.research_stage || '—';

  return `<dl class="kv">
      ${kv('المجال', profile.research_field || '—')}
      ${kv('التخصص', profile.specialization || '—')}
      ${kv('العنوان', profile.research_title || '—')}
      ${kv('الدرجة', DEGREE_LEVELS.find((item) => item.value === profile.degree_level)?.label || profile.degree_level || '—')}
      ${kv('الجامعة', profile.university || '—')}
      ${kv('المرحلة', stageLabel)}
    </dl>`;
}

/** صفحة حساب الباحث: البطاقة التعريفية + الرصيد + الملف البحثي + آخر العمليات.
 * الترتيب يطابق شبكة الإحصائية: بطاقة عريضة أعلى، ثم بطاقتان جنباً إلى جنب.
 * روابط القائمة المنسدلة (ملفي/الباقات/الخروج) لا تُكرَّر هنا — الصفحة للبيانات لا للتنقل.
 */
export function renderAccountPage({ account, profile, plan, usage, unread = 0 }) {
  const balance = Number(account.tokens_balance || 0);
  const used = Number(account.tokens_used || 0);
  const granted = Math.max(Number(account.tokens_granted || 0), balance + used, 1);
  const percent = Math.min(100, Math.round((used / granted) * 100));
  const isAdmin = account.role === 'admin';

  const hero = `<div class="card full account-hero">
    <div class="id-card">
      ${renderAvatar(account)}
      <div class="account-meta">
        <h2>${escapeHtml(account.full_name || 'باحث')}</h2>
        <p class="muted">${escapeHtml(account.email)}</p>
        <p class="id-meta">
          <span class="role-chip${isAdmin ? ' is-admin' : ''}">${icon(isAdmin ? 'shield' : 'user', 'icon-sm')} ${isAdmin ? 'مدير المنصة' : 'باحث'}</span>
          <span class="muted">عضو منذ ${escapeHtml(formatDate(account.created_at))}</span>
        </p>
      </div>
    </div>
    <div class="account-actions">
      ${account.onboarding_complete ? '<a class="btn" href="/onboarding">تعديل ملفي البحثي</a>' : '<a class="btn btn-primary" href="/onboarding">أكمل ملفك البحثي الآن</a>'}
    </div>
  </div>`;

  const balanceCard = `<div class="card">
    <div class="card-head">
      <h2>رصيد النقاط</h2>
      <a class="btn btn-primary btn-sm" href="/#pricing">${icon('coin', 'icon-sm')} إضافة نقاط</a>
    </div>
    <p class="balance">${escapeHtml(formatNumber(balance))} <span>نقطة متاحة</span></p>
    <div class="meter"><i style="width:${percent}%"></i></div>
    <p class="muted">استُهلك ${escapeHtml(formatNumber(used))} من إجمالي ${escapeHtml(
      formatNumber(granted)
    )} نقطة (${percent}%).</p>
    <dl class="kv">
      ${kv('الباقة الحالية', plan?.title || account.plan_code || 'لا توجد باقة')}
      ${kv('مساحة التخزين', plan?.storageMb ? formatStorageMb(plan.storageMb) : '—')}
      ${kv('خدمات باقتك', (plan?.services || []).map((key) => serviceLabel(key)).join(' · ') || '—')}
      ${kv('عمليات مسجّلة', formatNumber(usage.events))}
      ${kv('نقاط مستهلكة', formatNumber(used))}
    </dl>
  </div>`;

  const profileCard = `<div class="card">
    <div class="card-head">
      <h2>ملفي البحثي</h2>
      ${account.onboarding_complete ? '<a class="btn btn-sm" href="/onboarding">تعديل</a>' : ''}
    </div>
    ${profileSummary(profile)}
  </div>`;

  const usageCard = `<div class="card full">
    <h2>آخر عمليات الاستهلاك</h2>
    ${renderUsageList(usage.recent)}
  </div>`;

  const body = `<div class="account-grid">
  ${hero}
  ${balanceCard}
  ${profileCard}
  ${usageCard}
</div>`;

  return renderLayout({
    title: 'حسابي',
    subtitle: 'بياناتك ورصيد نقاطك وملفك البحثي في مكان واحد',
    area: 'app',
    activeKey: 'account',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}
/** ألوان مخططات الإحصائية — مشتقة من هوية المنصة (تفتيح/تعتيم فقط). */
const CHART_COLORS = ['#0d8e93', '#19b5a5', '#f4a261', '#7ecfc4', '#0a6f73', '#526777'];

/** بطاقة مؤشر واحدة في شريط الإحصائيات العلوي. */
function renderStat({ icon: iconName, label, value, hint = '' }) {
  return `<div class="stat-card">
  <span class="stat-icon">${icon(iconName, 'icon-sm')}</span>
  <div>
    <p class="stat-label">${escapeHtml(label)}</p>
    <p class="stat-value">${escapeHtml(value)}</p>
    ${hint ? `<p class="stat-hint">${escapeHtml(hint)}</p>` : ''}
  </div>
</div>`;
}

/**
 * مخطط أعمدة للنقاط المستهلكة في آخر ٧ أيام — CSS خالص (بلا مكتبات ولا سكربتات،
 * فيعمل مع CSP: 'self'). الترتيب RTL طبيعي: الأقدم يمين والأحدث يسار.
 */
function renderActivityBars(stats) {
  const days = stats?.days || [];
  if (!days.length) return '<div class="empty">لا تتوفّر بيانات نشاط بعد.</div>';

  const max = Math.max(stats.maxTokens || 0, 1);
  const bars = days
    .map((day, index) => {
      const height = day.tokens > 0 ? Math.max(6, Math.round((day.tokens / max) * 100)) : 0;
      // آخر عمود هو اليوم الحالي (سلسلة الأيام تنتهي بـ current_date)
      const isToday = index === days.length - 1;
      const title = `${day.dateLabel} — ${formatNumber(day.tokens)} نقطة في ${formatNumber(day.events)} عملية`;

      return `<div class="bar-col${isToday ? ' is-today' : ''}" title="${escapeHtml(title)}">
  <span class="bar-value${day.tokens ? '' : ' is-empty'}">${escapeHtml(formatNumber(day.tokens))}</span>
  <span class="bar-track"><i class="bar-fill" style="${height ? `height:${height}%` : ''}"></i></span>
  <span class="bar-label">${escapeHtml(isToday ? 'اليوم' : day.weekday)}</span>
</div>`;
    })
    .join('');

  return `<div class="bars" role="img" aria-label="النقاط المستهلكة في آخر سبعة أيام">${bars}</div>`;
}

/**
 * مخطط دائري (Donut) لتوزيع النقاط المستهلكة على أنواع العمليات، مع وسيلة إيضاح
 * بالنقاط والنسب. يُرسم بـ conic-gradient من الخادم (بلا JS).
 */
function renderUsageDonut(stats) {
  const rows = stats?.byType || [];
  const total = stats?.totalByType || 0;
  if (!total) return '<div class="empty">لا يوجد استهلاك مسجّل بعد لتوزيعه على الأنواع.</div>';

  let accumulated = 0;
  const stops = [];
  const legend = [];

  rows.forEach((row, index) => {
    const color = CHART_COLORS[index % CHART_COLORS.length];
    const share = row.tokens / total;
    const start = accumulated * 100;
    accumulated += share;
    stops.push(`${color} ${start.toFixed(2)}% ${(accumulated * 100).toFixed(2)}%`);

    legend.push(`<li class="legend-item">
  <span class="legend-dot" style="background:${color}"></span>
  <span class="legend-label">${escapeHtml(usageLabel(row.type))}</span>
  <span class="legend-value">${escapeHtml(formatNumber(row.tokens))} نقطة · ${Math.round(share * 100)}%</span>
</li>`);
  });

  return `<div class="donut-wrap">
  <div class="donut" style="background:conic-gradient(${stops.join(', ')})" role="img" aria-label="توزيع النقاط المستهلكة على أنواع العمليات">
    <span class="donut-hole"><b>${escapeHtml(formatNumber(total))}</b><em>نقطة مستهلكة</em></span>
  </div>
  <ul class="legend">${legend.join('')}</ul>
</div>`;
}

/** أعداد مكتبة الباحث البحثية (مراجع/ملاحظات/ملفات/أسئلة) في بطاقة واحدة. */
function renderLibraryStats(counts = {}) {
  const items = [
    { icon: 'book', label: 'مرجع في مكتبتك', value: counts.references ?? 0 },
    { icon: 'pin', label: 'ملاحظة في المفكرة', value: counts.notes ?? 0 },
    { icon: 'file', label: 'ملف مرفوع', value: counts.files ?? 0 },
    { icon: 'message', label: 'سؤال للمشرف الذكي', value: counts.questions ?? 0 }
  ];

  return `<ul class="mini-stats">${items
    .map(
      (item) => `<li>
  <span class="mini-icon">${icon(item.icon, 'icon-sm')}</span>
  <b>${escapeHtml(formatNumber(item.value))}</b>
  <span class="mini-label">${escapeHtml(item.label)}</span>
</li>`
    )
    .join('')}</ul>`;
}
/**
 * صفحة الإحصائية — الرئيسية للوحة الباحث: مؤشرات سريعة + مخططات (نشاط آخر ٧ أيام
 * وتوزيع الاستهلاك) + المسار والرصيد ومكتبة البحث وآخر العمليات.
 * ملاحظة: لا نُكرّر هنا روابط موجودة في الشريط الجانبي (المشرف الذكي/مسار البحث/…)
 * ولا بطاقات مكرّرة من صفحة الحساب — الصفحة للإحصاء وحده.
 */
export function renderDashboardPage({
  account,
  profile,
  plan,
  usage,
  journey = null,
  unread = 0,
  stats = null
}) {
  const balance = Number(account.tokens_balance ?? 0);
  const used = Number(usage.tokens ?? 0);
  const granted = balance + used;
  const percent = granted > 0 ? Math.min(100, Math.round((used / granted) * 100)) : 0;
  const firstName = String(account.full_name || 'باحث').trim().split(/\s+/)[0] || 'باحث';

  const safe = stats || {};
  const counts = safe.counts || {};

  // سياق الملف البحثي كشرائح مختصرة داخل الشريط الترحيبي (بدل بطاقة كاملة مكرّرة)
  const profileChips = profile
    ? [
        labelOf(RESEARCH_STAGES, profile.research_stage),
        profile.research_field,
        profile.university,
        labelOf(DEGREE_LEVELS, profile.degree_level)
      ].filter(Boolean)
    : [];

  const welcome = `<div class="card dash-welcome">
  <div class="dash-hello">
    <h2>أهلاً ${escapeHtml(firstName)} 👋</h2>
    <p class="muted">${
      profile
        ? 'هذه إحصائية حسابك — نشاطك وتقدّمك البحثي في مكان واحد.'
        : 'أكمل ملفك البحثي ليعرف المشرف الذكي مجالك ومرحلتك فتكون إجاباته أدق.'
    }</p>
  </div>
  <div class="dash-side">
    ${
      profileChips.length
        ? `<ul class="chips">${profileChips.map((chip) => `<li>${escapeHtml(chip)}</li>`).join('')}</ul>`
        : ''
    }
    ${profile ? '' : `<a class="btn btn-primary" href="/onboarding">${icon('userPlus', 'icon-sm')} أكمل ملفك البحثي</a>`}
  </div>
</div>`;

  const kpis = `<div class="stat-grid">
  ${renderStat({
    icon: 'coin',
    label: 'رصيد النقاط',
    value: formatNumber(balance),
    hint: `من أصل ${formatNumber(granted)} نقطة`
  })}
  ${renderStat({
    icon: 'sparkles',
    label: 'نقاط مستهلكة',
    value: formatNumber(used),
    hint: `${percent}% من رصيدك`
  })}
  ${renderStat({
    icon: 'graduation',
    label: 'تقدّم مسار البحث',
    value: journey ? `${journey.percent}%` : '—',
    hint: journey ? `${journey.done} من ${journey.total} خطوة` : 'أكمل ملفك البحثي'
  })}
  ${renderStat({
    icon: 'message',
    label: 'أسئلة للمشرف الذكي',
    value: formatNumber(counts.questions ?? 0),
    hint: `${formatNumber(counts.conversations ?? 0)} محادثة`
  })}
</div>`;

  const activityCard = `<div class="card chart-card full">
  <div class="card-head">
    <h2>${icon('sparkles', 'icon-sm')} نشاطك في آخر ٧ أيام</h2>
    <span class="chart-total">${escapeHtml(formatNumber(safe.weekTokens ?? 0))} نقطة · ${escapeHtml(
      formatNumber(safe.weekEvents ?? 0)
    )} عملية</span>
  </div>
  ${renderActivityBars(safe)}
</div>`;

  const donutCard = `<div class="card chart-card">
  <h2>${icon('coin', 'icon-sm')} توزيع استهلاكك حسب النوع</h2>
  ${renderUsageDonut(safe)}
</div>`;

  const journeyCard = `<div class="card">
  <h2>${icon('graduation', 'icon-sm')} مسار البحث</h2>
  ${
    journey
      ? `<div class="meter"><i style="width:${journey.percent}%"></i></div>
  <p class="muted">${escapeHtml(journey.title)} — أنجزت ${journey.done} من ${journey.total} خطوة (${journey.percent}%).</p>
  <dl class="kv">
    ${kv('الخطوات الإلزامية', `${formatNumber(journey.requiredDone ?? 0)} من ${formatNumber(journey.requiredTotal ?? 0)}`)}
    ${kv(journey.completed ? 'حالة المسار' : 'الخطوة التالية', journey.currentTitle)}
  </dl>`
      : '<div class="empty">أكمل ملفك البحثي أولاً ليظهر مسار بحثك.</div>'
  }
</div>`;

  const balanceCard = `<div class="card">
  <div class="card-head">
    <h2>رصيد النقاط</h2>
    <a class="btn btn-primary btn-sm" href="/#pricing">${icon('coin', 'icon-sm')} إضافة نقاط</a>
  </div>
  <p class="balance">${escapeHtml(formatNumber(balance))} <span>نقطة متاحة</span></p>
  <div class="meter"><i style="width:${percent}%"></i></div>
  <p class="muted">استُهلك ${escapeHtml(formatNumber(used))} من إجمالي ${escapeHtml(
    formatNumber(granted)
  )} نقطة (${percent}%).</p>
  <dl class="kv">
    ${kv('الباقة الحالية', plan?.title || account.plan_code || 'لا توجد باقة')}
    ${kv('مساحة التخزين', plan?.storageMb ? formatStorageMb(plan.storageMb) : '—')}
    ${kv('خدمات باقتك', (plan?.services || []).map((key) => serviceLabel(key)).join(' · ') || '—')}
    ${kv('عمليات مسجّلة', formatNumber(usage.events))}
    ${safe.lastActivity ? kv('آخر نشاط', formatDateTime(safe.lastActivity)) : ''}
  </dl>
</div>`;

  const libraryCard = `<div class="card">
  <h2>${icon('book', 'icon-sm')} مكتبتك البحثية</h2>
  ${renderLibraryStats(counts)}
  ${
    counts.failed
      ? `<p class="mini-note">${icon('refresh', 'icon-sm')} ${escapeHtml(
          formatNumber(counts.failed)
        )} محاولة لم تكتمل — لم تُخصم نقاطها.</p>`
      : ''
  }
</div>`;

  const usageCard = `<div class="card full">
  <h2>آخر عمليات الاستهلاك</h2>
  ${renderUsageList(usage.recent)}
</div>`;

  const body = `<div class="dash-grid">
  ${welcome}
  ${kpis}
  ${activityCard}
  ${donutCard}
  ${balanceCard}
  ${journeyCard}
  ${libraryCard}
  ${usageCard}
</div>`;

  return renderLayout({
    title: 'الإحصائية',
    subtitle: 'نشاطك وتقدّمك البحثي ورصيدك في مكان واحد',
    area: 'app',
    activeKey: 'dashboard',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}

export function renderAuthNotice({ title, message, details = '' }) {
  const body = `<div class="auth-form-side">
  <div class="auth-card">
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(message)}</p>
    ${details ? `<div class="alert">${details}</div>` : ''}
    <div class="auth-links"><a href="/">العودة إلى الصفحة الرئيسية</a></div>
  </div>
</div>`;

  return renderLayout({ title, area: 'auth', pageHead: false, body });
}
