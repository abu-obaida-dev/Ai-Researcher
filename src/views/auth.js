import {
  APP_NAME,
  CITATION_STYLES,
  DEGREE_LEVELS,
  GOAL_OPTIONS,
  PREFERRED_LANGUAGES,
  PROGRESS_LEVELS,
  RESEARCH_STAGES,
  SPECIALIZATIONS,
  TOKEN_COSTS
} from '../constants.js';
import { formatDate, formatDateTime, formatNumber } from './format.js';
import { googleIcon, icon } from './icons.js';
import { BRAND, escapeHtml, renderLayout, renderTable } from './layout.js';

/**
 * صفحات المصادقة والحساب: الدخول بحساب جوجل، إكمال الملف البحثي (onboarding)،
 * وصفحة الحساب — كلها HTML مولَّد على الخادم بدون React، وكل البيانات في PostgreSQL.
 */

/** مزايا التسجيل المعروضة في لوحة الدخول — الرصيد المجاني من الباقة المجانية */
function buildBenefits(freeTokens) {
  return [
    { icon: 'coins', text: `${formatNumber(freeTokens)} توكن مجاناً بمجرد التسجيل` },
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

/** تسمية عربية لنوع عملية الاستهلاك. */
function usageLabel(type) {
  return TOKEN_COSTS.find((item) => item.type === type)?.label || type;
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
        ${escapeHtml(formatNumber(freeTokens))} توكن مجاناً.
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
    text: 'بياناتك تُخزَّن في قاعدة بيانات المنصة (PostgreSQL) وتُستخدم لتخصيص الإشراف فقط، ويمكنك تعديلها في أي وقت.'
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
        <span class="muted">يُحفظ الملف في قاعدة بيانات المنصة ويمكنك تعديله في أي وقت.</span>
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

/** صفحة حساب الباحث: البيانات الأساسية + الرصيد + الملف البحثي + آخر العمليات. */
export function renderAccountPage({
  account,
  profile,
  plan,
  usage,
  notifications = { hint: { text: '' }, devices: 0, unread: 0 }
}) {
  const balance = Number(account.tokens_balance || 0);
  const used = Number(account.tokens_used || 0);
  const granted = Math.max(Number(account.tokens_granted || 0), balance + used, 1);
  const percent = Math.min(100, Math.round((used / granted) * 100));

  const profileCard = profile
    ? `<dl class="kv">
    ${kv('المرحلة الأكاديمية', labelOf(DEGREE_LEVELS, profile.degree_level))}
    ${kv('التخصص', profile.research_field)}
    ${kv('الجامعة', profile.university)}
    ${kv('الكلية / القسم', profile.faculty)}
    ${kv('السنة الأكاديمية', profile.academic_year)}
    ${kv('الحالة البحثية', labelOf(RESEARCH_STAGES, profile.research_stage))}
    ${kv('لغة الكتابة', labelOf(PREFERRED_LANGUAGES, profile.preferred_language))}
    ${kv('نظام التوثيق', labelOf(CITATION_STYLES, profile.citation_style))}
    ${kv('عنوان البحث', profile.research_title)}
  </dl>`
    : `<div class="empty">لم تُكمل ملفك البحثي بعد — إكماله يجعل ردود المشرف الذكي مبنية على مجالك ومرحلتك.</div>`;

  const usageRows = usage.recent.map(
    (row) => `
    <td>${escapeHtml(formatDateTime(row.created_at))}</td>
    <td>${escapeHtml(usageLabel(row.type))}</td>
    <td class="strong">${escapeHtml(formatNumber(row.tokens_used))}</td>
    <td class="muted">${escapeHtml(row.summary || '—')}</td>`
  );

  const body = `<div class="account-grid">
  <div class="card">
    <div class="id-card">
      ${renderAvatar(account)}
      <div>
        <h2>${escapeHtml(account.full_name || 'باحث')}</h2>
        <p class="muted">${escapeHtml(account.email)}</p>
        <p class="muted">${
          account.role === 'admin' ? 'مدير المنصة' : 'باحث'
        } · عضو منذ ${escapeHtml(formatDate(account.created_at))}</p>
      </div>
    </div>
    <div class="links">
      ${account.onboarding_complete ? '<a class="btn" href="/onboarding">تعديل ملفي البحثي</a>' : '<a class="btn btn-primary" href="/onboarding">أكمل ملفك البحثي الآن</a>'}
      <a class="btn" href="/#pricing">الباقات</a>
      ${account.role === 'admin' ? '<a class="btn" href="/admin">لوحة الإدارة</a>' : ''}
      <a class="btn" href="/logout">${icon('logout', 'icon-sm')} تسجيل الخروج</a>
    </div>
  </div>

  <div class="card">
    <h2>رصيد التوكنز</h2>
    <p class="balance">${escapeHtml(formatNumber(balance))} <span>توكن متاح</span></p>
    <div class="meter"><i style="width:${percent}%"></i></div>
    <p class="muted">استُهلك ${escapeHtml(formatNumber(used))} من إجمالي ${escapeHtml(
      formatNumber(granted)
    )} توكن (${percent}%).</p>
    <dl class="kv">
      ${kv('الباقة الحالية', plan?.title || account.plan_code || 'لا توجد باقة')}
      ${kv('عمليات مسجّلة', formatNumber(usage.events))}
      ${kv('توكنز مستهلكة', formatNumber(used))}
    </dl>
  </div>

  <div class="card">
    <h2>الإشعارات</h2>
    <p class="muted">${escapeHtml(notifications.hint.text)}</p>
    <dl class="kv">
      ${kv('أجهزة الهاتف المفعّلة', String(notifications.devices))}
      ${kv('إشعارات غير مقروءة', String(notifications.unread))}
    </dl>
    <div class="links">
      <a class="btn btn-primary" href="/notifications">${icon('bell', 'icon-sm')} إدارة الإشعارات</a>
    </div>
  </div>

  <div class="card">
    <h2>ملفي البحثي</h2>
    ${profileCard}
  </div>

  <div class="card">
    <h2>آخر عمليات الاستهلاك</h2>
    ${renderTable({
      columns: ['التاريخ', 'النوع', 'التوكنز', 'الملخص'],
      rows: usageRows,
      emptyMessage: 'لا توجد عمليات استهلاك مسجّلة بعد — ابدأ محادثة مع المشرف الذكي.'
    })}
  </div>
</div>`;

  return renderLayout({
    title: 'حسابي',
    subtitle: 'بياناتك البحثية ورصيد التوكنز محفوظة في قاعدة بيانات المنصة',
    area: 'app',
    activeKey: 'account',
    account,
    unread: notifications.unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}
export function renderAuthNotice({ title, message, details = '', firebaseWeb = null }) {
  const firebaseBlock = firebaseWeb?.ready
    ? `<div class="notice-firebase">
        <b>الإشعارات على هاتفك:</b>
        بعد الدخول افتح صفحة <a href="/notifications">الإشعارات</a> من نفس المتصفح على هاتفك
        واضغط «تفعيل الإشعارات» ليصلك جديد المنصة حتى والموقع مغلق.
      </div>`
    : '';

  const body = `<div class="auth-form-side">
  <div class="auth-card">
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(message)}</p>
    ${details ? `<div class="alert">${details}</div>` : ''}
    ${firebaseBlock}
    <div class="auth-links"><a href="/">العودة إلى الصفحة الرئيسية</a></div>
  </div>
</div>`;

  return renderLayout({ title, area: 'auth', pageHead: false, body });
}
