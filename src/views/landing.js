import {
  APP_NAME,
  PAYMENT_METHODS,
  PLATFORM_SERVICES,
  SITE_CURRENCIES,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP
} from '../constants.js';
import { whatsappLink } from './layout.js';
import { formatNumber } from './format.js';
import { formatStorageMb } from '../services/plans.js';
import { icon } from './icons.js';
import { BRAND, escapeHtml, renderLayout } from './layout.js';

/**
 * الصفحة الرئيسية للمنصة (صفحة الهبوط) — مولَّدة على الخادم بدون React، وبهوية Zena AI،
 * وبباقات مقروءة من جدول plans في PostgreSQL (مع سقوط آمن على الباقات الافتراضية).
 * الأقسام بالترتيب: Hero (بالشعار والشعار النصي) · Features · Services · HowItWorks ·
 * Audience (لمن المنصة + الأمانة العلمية) · Pricing · FAQ · CtaBand، ثم الفوتر المشترك.
 */

const FEATURES = [
  {
    icon: 'message',
    title: 'محادثة إشرافية ذكية',
    description: 'اسأل مشرفك عن أي جزء من البحث، واحصل على رد مبني على ملفك البحثي ومجال تخصصك، مع إشارة واضحة لما يحتاج تحققاً منك.'
  },
  {
    icon: 'list',
    title: 'خطة وهيكل البحث',
    description: 'بناء هيكل الرسالة وفصولها وأهدافها وفروضها البحثية بشكل متوافق مع منهجية البحث العلمي.'
  },
  {
    icon: 'book',
    title: 'مصادر ومراجع مقترحة',
    description: 'اقتراح دراسات سابقة مناسبة لمتغيرات بحثك وتوثيقها بنظام APA — تحقّق من كل مرجع قبل الاستشهاد به.'
  },
  {
    icon: 'language',
    title: 'مراجعة لغوية ومنهجية',
    description: 'مراجعة الفصول لغوياً وأسلوبياً مع ملاحظات على الاتساق والمنهجية وطريقة العرض العلمي.'
  },
  {
    icon: 'searchCheck',
    title: 'صياغة الفجوة البحثية',
    description: 'مناقشة الدراسات السابقة ومقارنة نتائجها وحدودها، لمساعدتك على صياغة الفجوة التي يعالجها بحثك.'
  },
  {
    icon: 'bulb',
    title: 'أفكار وفرضيات بحثية',
    description: 'توليد عناوين وفروض وأسئلة بحثية قابلة للقياس تناسب مرحلتك الدراسية وإمكاناتك.'
  }
];

/** خطوات البدء — نص الرصيد المجاني يُبنى من الباقة المجانية في قاعدة البيانات */
function buildSteps(freeTokens) {
  return [
    {
      icon: 'userPlus',
      title: 'سجّل بحساب جوجل',
      description: `دخول بضغطة واحدة بحساب جوجل بدون كلمات مرور، وتحصل مباشرة على ${formatNumber(freeTokens)} نقطة مجاناً.`
    },
    {
      icon: 'clipboard',
      title: 'أكمل ملفك البحثي',
      description: 'مجال البحث، الجامعة، الكلية، المرحلة الدراسية، واهتماماتك — بيانات تُستخدم لتخصيص ردود المشرف الذكي.'
    },
    {
      icon: 'rocket',
      title: 'ابدأ الإشراف البحثي',
      description: 'اطلب عنواناً أو هيكلاً أو مراجعة فصل أو مصادر، وتابع رصيدك واستهلاكك من صفحة حسابك.'
    }
  ];
}

/** القسم البطولي: النص التعريفي + بطاقة محادثة توضيحية + شريط أرقام. */
function renderHero(freeTokens) {
  const label = formatNumber(freeTokens);

  return `<section class="landing-hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <img class="hero-logo" src="${BRAND.mark}" alt="${escapeHtml(APP_NAME)}" width="190" height="52" />
      <span class="eyebrow-pill">${icon('sparkles', 'icon-sm')} إشراف بحثي ذكي مدعوم بالذكاء الاصطناعي</span>
      <h1>مشرف بحثي ذكي يرافقك من <span class="accent">الفكرة الأولى</span> إلى فصل متماسك</h1>
      <p class="hero-slogan">ابحث بعمق. اكتب بوضوح.</p>
      <p class="lead">
        منصة عربية تساعد طلاب الدراسات العليا والباحثين في اختيار العنوان، بناء هيكل الرسالة، مراجعة
        الفصول، واقتراح المصادر وتوثيقها — بملف بحثي مخصص يعرف مجالك وجامعتك ومرحلتك.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/login">ابدأ تجربتك المجانية ${icon('arrow', 'icon-sm')}</a>
        <a class="btn" href="/#pricing">استكشف الباقات</a>
      </div>
      <ul class="checklist">
        <li>ملف بحثي مخصص لمجالك</li>
        <li>${escapeHtml(label)} نقطة مجاناً</li>
        <li>بدون بطاقة بنكية</li>
      </ul>
    </div>

    <div class="hero-visual">
      <div class="hero-chat">
        <div class="hero-chat-head">
          <span class="hero-chat-agent">
            <img src="${BRAND.icon}" alt="" width="34" height="34" />
            <span><b>المشرف البحثي</b><em>نموذج توضيحي</em></span>
          </span>
          <span class="hero-chat-pill">${escapeHtml(label)} نقطة متاحة</span>
        </div>
        <div class="hero-chat-body">
          <p class="hero-bubble-user">أريد عنواناً لرسالة ماجستير في الذكاء الاصطناعي التعليمي</p>
          <div class="hero-bubble-ai">
            <strong>ثلاثة عناوين مقترحة:</strong>
            <p>1. أثر أنظمة الذكاء الاصطناعي التوليدي على التحصيل الدراسي الجامعي.</p>
            <p>2. تصميم بيئة تعلّم تكيفية معزّزة بنماذج اللغة الكبيرة.</p>
            <p>3. معايير تقييم جودة المحتوى التعليمي المُنتَج آلياً.</p>
          </div>
          <div class="typing" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="hero-stats">
    <div class="hero-stats-inner">
      <div class="stat-cell"><b>${escapeHtml(label)}</b><span>نقاط مجانية لكل باحث</span></div>
      <div class="stat-cell"><b>5 دقائق</b><span>لتجهيز ملفك البحثي</span></div>
      <div class="stat-cell"><b>24/7</b><span>مشرف متاح دائماً</span></div>
    </div>
  </div>
</section>`;
}

/** قسم المميزات: ست بطاقات بمحتوى المنصة نفسه. */
function renderFeatures() {
  const cards = FEATURES.map(
    (feature) => `<article class="feature-card">
  <span class="feature-icon">${icon(feature.icon)}</span>
  <h3>${escapeHtml(feature.title)}</h3>
  <p>${escapeHtml(feature.description)}</p>
</article>`
  ).join('');

  return `<section class="slab" id="features">
  <div class="slab-inner">
    <div class="center">
      <span class="eyebrow">المميزات</span>
      <h2 class="section-title">كل ما تحتاجه لإنجاز بحثك في مكان واحد</h2>
      <p class="section-lead">
        أدوات مصممة خصيصاً للباحث العربي، تعمل بالعربية والإنجليزية، وتحفظ سياق بحثك لتقدّم لك
        إشرافاً متسلسلاً وليس إجابات عامة.
      </p>
    </div>
    <div class="feature-grid">${cards}</div>
  </div>
</section>`;
}

/** قسم الخدمات: كل ما تُفتح عليه المنصة فعلياً (من PLATFORM_SERVICES) لا الدردشة فقط. */
function renderServices() {
  const cards = PLATFORM_SERVICES.map(
    (service) => `<article class="service-card">
  <span class="feature-icon">${icon(service.icon)}</span>
  <h3>${escapeHtml(service.label)}</h3>
  <p>${escapeHtml(service.note || '')}</p>
</article>`
  ).join('');

  return `<section class="slab" id="services">
  <div class="slab-inner">
    <div class="center">
      <span class="eyebrow">الخدمات</span>
      <h2 class="section-title">أدوات متكاملة داخل حساب واحد</h2>
      <p class="section-lead">
        كل خدمة تُفتح حسب باقتك وتُدار من لوحة واحدة: مسار بحث متسلسل، مكتبة علمية، مفكرة،
        مساحة ملفات، ومعها التدريب على المناقشة — بلا تنقّل بين مواقع متفرقة.
      </p>
    </div>
    <div class="service-grid">${cards}</div>
    <div class="center services-cta">
      <a class="btn btn-primary" href="/login">أنشئ حسابك وابدأ ${icon('arrow', 'icon-sm')}</a>
    </div>
  </div>
</section>`;
}

/** قسم «لمن هذه المنصة» + «الأمانة العلمية والخصوصية»: بطاقتان تقوّيان ثقة الباحث. */
function renderAudience() {
  const audience = [
    'باحث ماجستير يعمل على الفصول الأولى',
    'باحث دكتوراه يبني الإطار النظري والمنهجية',
    'طالب تخرّج يحضّر مشروع بحث',
    'باحث مستقل يقود بحثه بنفسه'
  ];
  const ethics = [
    'نستخدم بيانات ملفك البحثي لتخصيص ردود المشرف فقط — لا لتدريب النماذج ولا تُشارك مع أي جهة.',
    'المنصة أداة إشراف: تساعدك على البناء والمراجعة، والنصّ النهائي ومسؤوليته العلمية عليك.',
    'المراجع اقتراحات أولية: راجع كل مرجع في قاعدة علمية وتحقق منه قبل الاستشهاد به.',
    'دخول آمن بحساب جوجل بدون كلمات مرور، وجلسة موقّعة على الخادم.'
  ];

  return `<section class="slab slab-alt" id="audience">
  <div class="slab-inner">
    <div class="center">
      <span class="eyebrow">لمن هذه المنصة</span>
      <h2 class="section-title">مصمّمة لأي باحث، وبمسؤولية علمية واضحة</h2>
    </div>
    <div class="split-band">
      <article class="info-card">
        <h3>${icon('graduation', 'icon-sm')} تناسب مرحلتك الدراسية</h3>
        <ul class="info-list">${audience.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </article>
      <article class="info-card">
        <h3>${icon('shield', 'icon-sm')} الأمانة العلمية والخصوصية</h3>
        <ul class="info-list">${ethics.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </article>
    </div>
  </div>
</section>`;
}

/** قسم «كيف تعمل» — ثلاث خطوات فقط (جدول استهلاك النقاط حُذف بقرار المحتوى). */
function renderHowItWorks(freeTokens) {
  const steps = buildSteps(freeTokens)
    .map(
      (step, index) => `<article class="step-card">
  <span class="step-badge">${index + 1}</span>
  <span class="feature-icon">${icon(step.icon)}</span>
  <h3>${escapeHtml(step.title)}</h3>
  <p>${escapeHtml(step.description)}</p>
</article>`
    )
    .join('');

  return `<section class="slab slab-alt" id="how">
  <div class="slab-inner">
    <div class="center">
      <span class="eyebrow">كيف تعمل</span>
      <h2 class="section-title">ثلاث خطوات وتبدأ مع مشرفك الذكي</h2>
    </div>

    <div class="steps-grid">${steps}</div>
  </div>
</section>`;
}

/**
 * بطاقة باقة واحدة — تُبنى من صف جدول plans بعد توليد المزايا من صلاحيات
 * دور الباقة (services/plans.js)، فالمزايا المعروضة = ما يفتحه الباحث فعلاً.
 */
function renderPlanCard(plan, currency) {
  const isFree = Number(plan.price) === 0;
  const features = plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');
  const symbol = SITE_CURRENCIES.find((item) => item.code === currency)?.symbol || 'د.ل';

  return `<article class="plan${plan.popular ? ' featured' : ''}">
  ${plan.popular ? '<span class="plan-flag">الأكثر اختياراً</span>' : ''}
  <h3>${escapeHtml(plan.title)}</h3>
  <p class="tagline">${escapeHtml(plan.tagline)}</p>
  <div class="plan-price">
    <b>${escapeHtml(isFree ? 'مجاناً' : formatNumber(plan.price))}</b>${isFree ? '' : `<span>${escapeHtml(symbol)}</span>`}
  </div>
  <p class="plan-period">${escapeHtml(plan.period)}</p>
  <span class="plan-tokens">${icon('coin', 'icon-sm')} ${escapeHtml(formatNumber(plan.tokens))} نقطة</span>
  <span class="plan-storage">${icon('clipboard', 'icon-sm')} ${escapeHtml(formatStorageMb(plan.storageMb))} مساحة تخزين</span>
  <ul class="plan-features">${features}</ul>
  <a class="btn${isFree ? '' : ' btn-primary'}" href="${isFree ? '/login' : `/payments?plan=${encodeURIComponent(plan.code)}`}">${escapeHtml(
    plan.cta
  )}</a>
</article>`;
}

/** قسم الباقات: البطاقات من قاعدة البيانات + طرق الدفع المتاحة. */
function renderPricing(plans, currency, methods = PAYMENT_METHODS) {
  const cards = plans.map((plan) => renderPlanCard(plan, currency)).join('');
  const list = methods.length ? methods : PAYMENT_METHODS;
  const readyMethods =
    list
      .filter((method) => method.ready !== false && method.isActive !== false)
      .map((method) => {
        const name = method.name || method.label || '';
        const note = String(method.note || '').trim();
        return note ? `${name} (${note})` : name;
      })
      .filter(Boolean)
      .join(' · ') || 'الدفع اليدوي عبر الإدارة';

  return `<section class="slab" id="pricing">
  <div class="slab-inner">
    <div class="center">
      <span class="eyebrow">الباقات</span>
      <h2 class="section-title">ابدأ مجاناً ثم اختر الباقة المناسبة لمرحلتك</h2>
      <p class="section-lead">
        كل باقة تمنحك رصيداً من النقاط يُستخدم في جميع أدوات المنصة، ويمكنك الترقية أو التغيير في أي وقت.
      </p>
    </div>

    <div class="plans">${cards}</div>

    <p class="plans-note">
      تحتاج باقة مخصصة لجامعة أو كلية أو مجموعة باحثين؟ راسلنا على
      <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a>${
        whatsappLink() ? ` أو واتساب ${escapeHtml(process.env.SUPPORT_WHATSAPP || SUPPORT_WHATSAPP)}.` : '.'
      }
    </p>
    <p class="plans-note">طرق الدفع المتاحة: ${escapeHtml(readyMethods)} — وبطاقة بنكية قريباً.</p>
  </div>
</section>`;
}

/** قسم الأسئلة الشائعة بعناصر details الأصلية (بدون JavaScript). */
function renderFaq(freeTokens) {
  const items = buildFaqs(freeTokens)
    .map(
      (item) => `<details class="faq-item">
  <summary>${escapeHtml(item.question)}</summary>
  <p>${escapeHtml(item.answer)}</p>
</details>`
    )
    .join('');

  return `<section class="slab slab-alt" id="faq">
  <div class="slab-inner narrow">
    <div class="center">
      <span class="eyebrow">الأسئلة الشائعة</span>
      <h2 class="section-title">كل ما تريد معرفته قبل البدء</h2>
    </div>
    <div class="faq-list">${items}</div>
  </div>
</section>`;
}

/** شريط الدعوة الأخير قبل الفوتر. */
function renderCtaBand(freeTokens) {
  return `<section class="cta-band">
  <div class="cta-inner">
    <div>
      <h2>ابدأ رحلتك البحثية اليوم</h2>
      <p>
        ${escapeHtml(formatNumber(freeTokens))} نقاط مجانية بلا بطاقة بنكية، وملف بحثي يجهز في 5 دقائق.
        رصيدك يبقى محفوظاً ويمكنك الترقية وقتما تشاء.
      </p>
    </div>
    <div class="cta-actions">
      <a class="btn btn-light" href="/login">ابدأ تجربتك المجانية ${icon('arrow', 'icon-sm')}</a>
      <a class="btn btn-ghost-light" href="/#pricing">${icon('sparkles', 'icon-sm')} مقارنة الباقات</a>
    </div>
  </div>
</section>`;
}

/**
 * الصفحة الرئيسية كاملة.
 * plans: باقات الموقع (من listPublicPlans)، freeTokens: رصيد التجربة المجانية،
 * account: الحساب الحالي إن وُجدت جلسة (لتغيير أزرار الترويسة).
 */
export function renderLandingPage({ plans, freeTokens, account = null, currency = 'LYD', paymentMethods = [] }) {
  const body = [
    renderHero(freeTokens),
    renderFeatures(),
    renderServices(),
    renderHowItWorks(freeTokens),
    renderAudience(),
    renderPricing(plans, currency, paymentMethods),
    renderFaq(freeTokens),
    renderCtaBand(freeTokens)
  ].join('\n');

  return renderLayout({
    title: `${APP_NAME} — مشرفك البحثي الذكي`,
    area: 'public',
    pageHead: false,
    account,
    body
  });
}
function buildFaqs(freeTokens) {
  return [
    {
      question: 'ما الذي أحصل عليه مجاناً عند التسجيل؟',
      answer: `يحصل كل حساب جديد على ${formatNumber(freeTokens)} نقطة مجاناً بمجرد التسجيل بحساب جوجل، وبلا أي بطاقة بنكية أو التزام.`
    },
    {
      question: 'ما المقصود بالنقطة؟',
      answer:
        'النقطة هو وحدة قياس استهلاك الذكاء الاصطناعي. كل عملية على المنصة (رسالة، هيكل بحث، مراجعة فصل، اقتراح مصادر) تستهلك عدداً معروفاً من النقاط، ويظهر لك رصيدك وسجل استهلاكك الكامل من صفحة حسابك.'
    },
    {
      question: 'هل المصادر المقترحة جاهزة للاستخدام مباشرة؟',
      answer:
        'المراجع قوائم اقتراحات أولية يولّدها المشرف الذكي، والمنصة لا تتحقق منها تلقائياً. راجع كل مرجع في قاعدة علمية مثل Google Scholar أو Scopus وتأكد من صحة بياناته قبل الاستشهاد به.'
    },
    {
      question: 'هل تكتب المنصة الدراسة بدلاً مني؟',
      answer:
        'لا. المنصة أداة إشراف: تساعدك على بناء الخطة، وصياغة الأسئلة، ومراجعة ما تكتبه أنت — والنص النهائي ومسؤوليته عليك، وهو ما تريده لجنة المناقشة.'
    },
    {
      question: 'كيف تُستخدم بياناتي البحثية؟',
      answer:
        'نستخدم بياناتك (مجال البحث، الجامعة، المرحلة الدراسية، الاهتمامات) لتخصيص ردود المشرف الذكي فقط، بحيث تكون الإجابات مناسبة لتخصصك ومستواك العلمي، ولا تُستخدم لتدريب النماذج ولا تُشارك مع أي جهة خارجية.'
    },
    {
      question: 'هل يدعم الموقع اللغة الإنجليزية؟',
      answer:
        'نعم، تختار لغة الكتابة المفضلة (العربية أو الإنجليزية أو كلتاهما) عند تجهيز ملفك البحثي، ويراعيها المشرف الذكي في كل الردود والمصادر المقترحة.'
    },
    {
      question: 'ما طرق الدفع المتاحة حالياً؟',
      answer: `حالياً ${PAYMENT_METHODS.filter((method) => method.ready)
        .map((method) => method.name)
        .join(' و')}، والعمل جارٍ على تفعيل الدفع بالبطاقات البنكية عبر بوابة دفع إلكترونية داخل المنصة.`
    },
    {
      question: 'هل يمكنني إلغاء الاشتراك؟',
      answer:
        'الباقات شهرية بدون أي ارتباط طويل، ويمكنك التوقف في أي وقت، مع الاحتفاظ بما تبقى من رصيد النقاط خلال المدة المدفوعة.'
    }
  ];
}
