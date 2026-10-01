import { APP_NAME, PAYMENT_METHODS, SUPPORT_EMAIL, SUPPORT_WHATSAPP, TOKEN_COSTS } from '../constants.js';
import { formatNumber } from './format.js';
import { icon } from './icons.js';
import { BRAND, escapeHtml, renderLayout } from './layout.js';

/**
 * الصفحة الرئيسية للمنصة (صفحة الهبوط) — نفس أقسام ومحتوى النسخة القديمة
 * (Navbar / Hero / Features / HowItWorks / Pricing / FAQ / CtaBand / Footer)
 * لكن مولَّدة على الخادم بدون React، وبهوية Zena AI، وبباقات مقروءة من جدول plans
 * في PostgreSQL (مع سقوط آمن على الباقات الافتراضية).
 */

const FEATURES = [
  {
    icon: 'message',
    title: 'محادثة إشرافية ذكية',
    description: 'اسأل مشرفك عن أي جزء من البحث، وسيحصل على رد علمي مبني على ملفك البحثي ومجال تخصصك.'
  },
  {
    icon: 'list',
    title: 'خطة وهيكل البحث',
    description: 'بناء هيكل الرسالة وفصولها وأهدافها وفروضها البحثية بشكل متوافق مع منهجية البحث العلمي.'
  },
  {
    icon: 'book',
    title: 'مصادر ومراجع مقترحة',
    description: 'اقتراح المراجع والدراسات السابقة المناسبة لمتغيرات البحث مع صياغة الاقتباس بشكل صحيح.'
  },
  {
    icon: 'language',
    title: 'مراجعة لغوية ومنهجية',
    description: 'مراجعة الفصول لغوياً وأسلوبياً مع ملاحظات على الاتساق والمنهجية وطريقة العرض العلمي.'
  },
  {
    icon: 'searchCheck',
    title: 'تحليل الدراسات السابقة',
    description: 'تلخيص ومقارنة الدراسات العربية والأجنبية لاستخراج الفجوة البحثية التي يعالجها بحثك.'
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
      description: `دخول بضغطة واحدة بدون كلمات مرور أو رسائل تأكيد، وتحصل مباشرة على ${formatNumber(freeTokens)} نقطة مجاناً.`
    },
    {
      icon: 'clipboard',
      title: 'أكمل ملفك البحثي',
      description: 'مجال البحث، الجامعة، الكلية، المرحلة الدراسية، واهتماماتك — بيانات تُستخدم لتخصيص ردود المشرف الذكي.'
    },
    {
      icon: 'rocket',
      title: 'ابدأ الإشراف البحثي',
      description: 'اطلب عنواناً، هيكلاً، مراجعة فصل، أو مصادر، وتابع استهلاكك من النقاط لحظة بلحظة.'
    }
  ];
}

/** القسم البطولي: النص التعريفي + بطاقة محادثة توضيحية + شريط أرقام. */
function renderHero(freeTokens) {
  const label = formatNumber(freeTokens);

  return `<section class="landing-hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <span class="eyebrow-pill">${icon('sparkles', 'icon-sm')} مدعوم بالذكاء الاصطناعي التوليدي</span>
      <h1>مشرف بحثي ذكي يرافقك من <span class="accent">فكرة البحث</span> حتى المناقشة</h1>
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
      <div class="chat-card">
        <div class="chat-head">
          <span class="chat-agent">
            <img src="${BRAND.icon}" alt="" width="34" height="34" />
            <span><b>المشرف البحثي</b><em>متصل الآن</em></span>
          </span>
          <span class="chat-pill">${escapeHtml(label)} نقطة متاحة</span>
        </div>
        <div class="chat-body">
          <p class="bubble-user">أريد عنواناً لرسالة ماجستير في الذكاء الاصطناعي التعليمي</p>
          <div class="bubble-ai">
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

/** قسم «كيف تعمل» + جدول استهلاك النقاط. */
function renderHowItWorks(freeTokens) {
  const steps = buildSteps(freeTokens)
    .map(
      (step, index) => `<article class="step-card">
  <span class="step-number">${index + 1}</span>
  <span class="feature-icon">${icon(step.icon)}</span>
  <h3>${escapeHtml(step.title)}</h3>
  <p>${escapeHtml(step.description)}</p>
</article>`
    )
    .join('');

  const costs = TOKEN_COSTS.map(
    (item) => `<div class="cost-card">
  <header><b>${escapeHtml(item.label)}</b><span class="cost-pill">${escapeHtml(formatNumber(item.tokens))} نقطة</span></header>
  <p>${escapeHtml(item.description)}</p>
</div>`
  ).join('');

  return `<section class="slab slab-alt" id="how">
  <div class="slab-inner">
    <div class="center">
      <span class="eyebrow">كيف تعمل</span>
      <h2 class="section-title">ثلاث خطوات وتبدأ مع مشرفك الذكي</h2>
    </div>

    <div class="steps-grid">${steps}</div>

    <div class="costs">
      <div class="costs-head">
        <span class="feature-icon warm">${icon('coins')}</span>
        <div>
          <h3>كيف يُحسب استهلاك النقاط؟</h3>
          <p>كل عملية على المنصة تستهلك عدداً ثابتاً من النقاط، ويظهر لك رصيدك وكل عملية قمت بها من صفحة حسابك.</p>
        </div>
      </div>
      <div class="cost-grid">${costs}</div>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/login">جرّب الآن بـ ${escapeHtml(formatNumber(freeTokens))} نقطة مجاناً</a>
      </div>
    </div>
  </div>
</section>`;
}

/** بطاقة باقة واحدة — تُبنى من صف جدول plans أو من الباقة الافتراضية. */
function renderPlanCard(plan) {
  const isFree = Number(plan.price) === 0;
  const features = plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');

  return `<article class="plan${plan.popular ? ' featured' : ''}">
  ${plan.popular ? '<span class="plan-flag">الأكثر اختياراً</span>' : ''}
  <h3>${escapeHtml(plan.title)}</h3>
  <p class="tagline">${escapeHtml(plan.tagline)}</p>
  <div class="plan-price">
    <b>${escapeHtml(isFree ? 'مجاناً' : formatNumber(plan.price))}</b>${isFree ? '' : '<span>ج.م</span>'}
  </div>
  <p class="plan-period">${escapeHtml(plan.period)}</p>
  <span class="plan-tokens">${icon('coin', 'icon-sm')} ${escapeHtml(formatNumber(plan.tokens))} نقطة</span>
  <ul class="plan-features">${features}</ul>
  <a class="btn${isFree ? '' : ' btn-primary'}" href="/login">${escapeHtml(plan.cta)}</a>
</article>`;
}

/** قسم الباقات: البطاقات من قاعدة البيانات + طرق الدفع المتاحة. */
function renderPricing(plans) {
  const cards = plans.map(renderPlanCard).join('');
  const readyMethods = PAYMENT_METHODS.filter((method) => method.ready)
    .map((method) => `${method.name} (${method.note})`)
    .join(' · ');

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
      <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a>
      أو واتساب ${escapeHtml(SUPPORT_WHATSAPP)}.
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
export function renderLandingPage({ plans, freeTokens, account = null }) {
  const body = [
    renderHero(freeTokens),
    renderFeatures(),
    renderHowItWorks(freeTokens),
    renderPricing(plans),
    renderFaq(freeTokens),
    renderCtaBand(freeTokens)
  ].join('\n');

  return renderLayout({
    title: `${APP_NAME} — مساعدك البحثي الذكي`,
    area: 'public',
    pageHead: false,
    account,
    body
  });
}
function buildFaqs(freeTokens) {
  return [
    {
      question: 'هل التجربة المجانية حقيقية؟',
      answer: `نعم، يحصل كل حساب جديد على ${formatNumber(freeTokens)} نقطة مجاناً بمجرد التسجيل بحساب جوجل، وبدون أي بطاقة بنكية أو التزام.`
    },
    {
      question: 'ما المقصود بالنقطة؟',
      answer:
        'النقطة هو وحدة قياس استهلاك الذكاء الاصطناعي. كل عملية على المنصة (رسالة، هيكل بحث، مراجعة فصل، اقتراح مصادر) تستهلك عدداً معروفاً من النقاط، ويظهر لك رصيدك وسجل استهلاكك الكامل من صفحة حسابك.'
    },
    {
      question: 'كيف تُستخدم بياناتي البحثية؟',
      answer:
        'نستخدم بياناتك (مجال البحث، الجامعة، المرحلة الدراسية، الاهتمامات) لتخصيص ردود المشرف الذكي فقط، بحيث تكون الإجابات مناسبة لتخصصك ومستواك العلمي، ولا تُشارك مع أي جهة خارجية.'
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
