/** Shared constants for server-rendered pages and services. */

export const APP_NAME = 'Zena AI';
export const APP_TAGLINE = 'المشرف البحثي الذكي';
export const SUPPORT_EMAIL = 'libyonix7@gmail.com';
/** Optional support number; an empty value hides the support link. */
export const SUPPORT_WHATSAPP = '+218 93-0108734';

/** Welcome credits granted to new users. */
export const FREE_TRIAL_TOKENS = 10000;

/** Code of the free plan in the plans table. */
export const FREE_PLAN_CODE = 'free_trial';

/** Validate route identifiers before passing them to PostgreSQL UUID columns. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns whether a value is a valid UUID. */
export function isUuid(value) {
  return UUID_RE.test(String(value ?? '').trim());
}

export const TOKEN_COSTS = [
  {
    type: 'chat',
    label: 'رسالة إلى المشرف الذكي',
    tokens: 30,
    description: 'يُخصم فعلياً بعد كل رد، ويُردّ الفرق إن كان الاستهلاك أقل من المتوقع'
  },
  { type: 'translate', label: 'ترجمة وصياغة أكاديمية', tokens: 60, description: 'ترجمة عربي/إنجليزي بصياغة علمية' },
  { type: 'outline', label: 'بناء خطة وهيكل بحث', tokens: 80, description: 'تقسيم الفصول والمحاور والأهداف' },
  { type: 'sources', label: 'اقتراح مصادر ومراجع', tokens: 120, description: 'قائمة مراجع مع توثيق APA' },
  { type: 'review', label: 'مراجعة فصل أو مقطع', tokens: 150, description: 'مراجعة منهجية ولغوية مع ملاحظات تفصيلية' }
];

/** Usage rates support preauthorization followed by settlement against actual provider usage. */
export const TOKEN_RATES = {
  inputPer1k: 5,
  outputPer1k: 20,
  reserveBuffer: 1.08
};

/** Hard response-token limits by chat mode. */
export const CHAT_REPLY_CAPS = { normal: 900, defense: 1400 };

/** Reads the price multiplier, falling back to 1. */
export function priceMultiplier() {
  const raw = Number(process.env.AI_PRICE_MULTIPLIER);
  return Number.isFinite(raw) && raw > 0 && raw <= 10 ? raw : 1;
}

export const GENDER_OPTIONS = [
  { value: 'male', label: 'شاب' },
  { value: 'female', label: 'بنت' }
];

/** Country calling codes, expected national-number lengths, and example numbers. */
export const WHATSAPP_COUNTRIES = [
  { code: 'LY', name: 'ليبيا', dial: '218', lengths: [9], pattern: '^9[124][0-9]{7}$', sample: '+218912345678' },
  { code: 'EG', name: 'مصر', dial: '20', lengths: [10, 11], sample: '+201012345678' },
  { code: 'SA', name: 'السعودية', dial: '966', lengths: [9], sample: '+966512345678' },
  { code: 'AE', name: 'الإمارات', dial: '971', lengths: [9], sample: '+971501234567' },
  { code: 'KW', name: 'الكويت', dial: '965', lengths: [8], sample: '+96591234567' },
  { code: 'QA', name: 'قطر', dial: '974', lengths: [8], sample: '+97433123456' },
  { code: 'BH', name: 'البحرين', dial: '973', lengths: [8], sample: '+97336123456' },
  { code: 'OM', name: 'عُمان', dial: '968', lengths: [8], sample: '+96891234567' },
  { code: 'IQ', name: 'العراق', dial: '964', lengths: [10], sample: '+9647701234567' },
  { code: 'JO', name: 'الأردن', dial: '962', lengths: [9], sample: '+962791234567' },
  { code: 'LB', name: 'لبنان', dial: '961', lengths: [7, 8], sample: '+9617123456' },
  { code: 'SY', name: 'سوريا', dial: '963', lengths: [9], sample: '+963912345678' },
  { code: 'PS', name: 'فلسطين', dial: '970', lengths: [9], sample: '+970591234567' },
  { code: 'YE', name: 'اليمن', dial: '967', lengths: [9], sample: '+967712345678' },
  { code: 'SD', name: 'السودان', dial: '249', lengths: [9], sample: '+249912345678' },
  { code: 'MA', name: 'المغرب', dial: '212', lengths: [9], sample: '+212612345678' },
  { code: 'DZ', name: 'الجزائر', dial: '213', lengths: [9, 10], sample: '+213512345678' },
  { code: 'TN', name: 'تونس', dial: '216', lengths: [8], sample: '+21621234567' },
  { code: 'MR', name: 'موريتانيا', dial: '222', lengths: [8], sample: '+22241234567' },
  { code: 'SO', name: 'الصومال', dial: '252', lengths: [8, 9], sample: '+252612345678' },
  { code: 'DJ', name: 'جيبوتي', dial: '253', lengths: [8], sample: '+25377123456' },
  { code: 'KM', name: 'جزر القمر', dial: '269', lengths: [7], sample: '+2693212345' }
];

export const DEGREE_LEVELS = [
  { value: 'bachelor', label: 'طالب جامعي (بكالوريوس)' },
  { value: 'master', label: 'باحث ماجستير' },
  { value: 'phd', label: 'باحث دكتوراه' },
  { value: 'diploma', label: 'دبلوم دراسات عليا' },
  { value: 'independent', label: 'باحث مستقل' }
];

export const RESEARCH_STAGES = [
  { value: 'topic', label: 'اختيار الموضوع والفكرة' },
  { value: 'proposal', label: 'إعداد المقترح البحثي' },
  { value: 'literature', label: 'الإطار النظري والدراسات السابقة' },
  { value: 'methodology', label: 'بناء المنهجية' },
  { value: 'data', label: 'جمع البيانات' },
  { value: 'analysis', label: 'تحليل البيانات' },
  { value: 'writing', label: 'كتابة الفصول والتحرير' },
  { value: 'discussion', label: 'مناقشة النتائج والاستنتاجات' },
  { value: 'defense', label: 'التحضير للمناقشة/الدفاع' }
];

export const RESEARCH_FIELDS = [
  'الذكاء الاصطناعي', 'علوم الحاسوب', 'علم البيانات', 'الأمن السيبراني', 'هندسة الحاسبات',
  'الهندسة', 'الطب البشري', 'طب الأسنان', 'الصيدلة', 'التمريض', 'العلوم الطبية الأساسية',
  'الصحة العامة', 'الأحياء', 'الكيمياء', 'الفيزياء', 'الرياضيات', 'الإحصاء وبحوث العمليات',
  'الزراعة', 'علوم الأغذية', 'العلوم البيئية', 'الجيولوجيا وعلوم الأرض', 'إدارة الأعمال',
  'المحاسبة', 'الاقتصاد', 'القانون', 'الإعلام والصحافة', 'علم النفس', 'علم الاجتماع', 'التربية',
  'اللغات والآداب', 'التاريخ والآثار', 'الهندسة المعمارية', 'التخطيط العمراني', 'التربية الرياضية',
  'أخرى'
];

/** Short specialization list used by onboarding. */
export const SPECIALIZATIONS = [
  'أخرى', 'القانون', 'الطب', 'الهندسة', 'الاقتصاد', 'الإدارة', 'العلوم الإنسانية',
  'تقنية المعلومات', 'التربية', 'علم النفس', 'علوم الحاسب', 'اللغات والترجمة', 'العمارة',
  'العلوم الاجتماعية', 'العلوم التطبيقية'
];

/** Onboarding goals mapped to initial supervisor stages. */
export const GOAL_OPTIONS = [
  { value: 'topic', label: 'اختيار فكرة أو موضوع البحث' },
  { value: 'proposal', label: 'إعداد خطة أو مقترح البحث' },
  { value: 'literature', label: 'بناء الإطار النظري ومراجعة الدراسات السابقة' },
  { value: 'methodology', label: 'تطوير منهجية البحث' },
  { value: 'writing', label: 'كتابة الفصول والتحرير' },
  { value: 'analysis', label: 'مراجعة البحث أو تحليل النتائج' },
  { value: 'discussion', label: 'مناقشة النتائج والاستنتاجات' },
  { value: 'defense', label: 'التحضير للمناقشة/الدفاع' }
];

/** Research project progress stages. */
export const PROGRESS_LEVELS = [
  { value: 'topic', label: 'لم أبدأ بعد' },
  { value: 'proposal', label: 'لدي موضوع محدد' },
  { value: 'literature', label: 'أعمل على الإطار النظري' },
  { value: 'writing', label: 'بدأت الكتابة' },
  { value: 'analysis', label: 'لدي بحث كامل وأحتاج مراجعة' }
];

export const ACADEMIC_YEARS = [
  'السنة الأولى', 'السنة الثانية', 'السنة الثالثة', 'السنة الرابعة', 'السنة الخامسة', 'دراسات عليا'
];

export const PREFERRED_LANGUAGES = [
  { value: 'ar', label: 'العربية' },
  { value: 'en', label: 'الإنجليزية' },
  { value: 'both', label: 'كلتاهما' }
];

export const CITATION_STYLES = [
  { value: 'apa7', label: 'APA 7 (العلوم الاجتماعية والتربوية)' },
  { value: 'mla9', label: 'MLA 9 (اللغات والأدب)' },
  { value: 'chicago17', label: 'Chicago 17 (التاريخ والإنسانيات)' },
  { value: 'ieee', label: 'IEEE (الهندسة وعلوم الحاسوب)' },
  { value: 'harvard', label: 'Harvard (إدارة الأعمال والاقتصاد)' }
];

export const UNIVERSITIES = [
  'جامعة القاهرة', 'جامعة عين شمس', 'جامعة الإسكندرية', 'جامعة المنصورة', 'جامعة طنطا',
  'جامعة الزقازيق', 'جامعة أسيوط', 'جامعة حلوان', 'جامعة بني سويف', 'جامعة المنيا',
  'جامعة سوهاج', 'جامعة جنوب الوادي', 'جامعة الفيوم', 'جامعة دمنهور', 'جامعة كفر الشيخ',
  'جامعة مدينة السادات', 'جامعة السويس', 'جامعة بورسعيد', 'جامعة الإسماعيلية', 'جامعة الأزهر',
  'جامعة مصر للعلوم والتكنولوجيا', 'الجامعة الأمريكية بالقاهرة', 'الجامعة الألمانية بالقاهرة',
  'جامعة مصر الدولية', 'جامعة النيل', 'أكاديمية البحث العلمي', 'أخرى'
];

/** Public page navigation links. */
export const PUBLIC_NAV = [
  { href: '/#features', label: 'المميزات' },
  { href: '/#services', label: 'الخدمات' },
  { href: '/#how', label: 'كيف تعمل' },
  { href: '/#pricing', label: 'الباقات' },
  { href: '/#faq', label: 'الأسئلة الشائعة' }
];

/**
 * Default plan storage in megabytes.
 * Admins manage this value in plans.storage_mb.
 * كل الباقات تشترك في نفس الحصة العامة (500 MB) حتى يغيّرها المدير.
 */
export const PLAN_STORAGE_DEFAULT_MB = 500;

/** أقصى حصة تخزين يمكن أن يمنحها المدير لباقة (100 GB) — حدّ حماية للأقراص. */
export const PLAN_STORAGE_MAX_MB = 102400;

/**
 * حدّ حجم الملف الواحد الافتراضي للمشترك (MB) — مصدره plans.max_file_mb
 * القيمة تُضبط لكل باقة على حدة من صفحة «الباقات» (أقصى حجم للملف الواحد)،
 * وتُطبَّق عند رفع الملفات ومعاينتها. حدّ المنصة العام (settings) أُلغي بقرار المنصة.
 */
export const PLAN_FILE_DEFAULT_MB = 100;

/** أقصى حجم ملف واحد يمكن أن يمنحه المدير لباقة (2048 MB) — حدّ حماية. */
export const PLAN_FILE_MAX_MB = 2048;

/**
 * الباقات الافتراضية — مصدر واحد مزدوج الاستخدام:
 * 1) بذرة جدول plans عند تنفيذ npm run db:seed.
 * 2) سقوط آمن لعرض صفحة الهبوط إذا تعذّرت قراءة قاعدة البيانات.
 *
 * ملاحظة مهمة عن «المزايا»: ما يُعرض في بطاقة الباقة **ليس** هنا، بل يُولَّد في
 * services/plans.js من صلاحيات دور الباقة في قاعدة البيانات (role_permissions)
 * + حصة التخزين من plans.storage_mb + حد الملف الواحد من plans.max_file_mb — فلا
 * تختلف advertorial عن ما يفتحه فعلياً.
 * الحقل features هنا/في الجدول = أسطر إضافية اختيارية يكتبها المدير، تُعرض
 * بعد المزايا المولَّدة (مثل «بدون بطاقة بنكية»).
 */
export const DEFAULT_PLANS = [
  {
    code: 'free_trial',
    title: 'التجربة المجانية',
    tagline: 'ابدأ الإشراف البحثي بلا التزام',
    price: 0,
    tokens: FREE_TRIAL_TOKENS,
    period: 'مرة واحدة عند التسجيل',
    periodDays: 0,
    cta: 'ابدأ مجاناً',
    popular: false,
    displayOrder: 1,
    roleCode: 'free',
    storageMb: PLAN_STORAGE_DEFAULT_MB,
    fileMaxMb: PLAN_FILE_DEFAULT_MB,
    features: [`${FREE_TRIAL_TOKENS.toLocaleString('en-US')} نقطة عند إنشاء الحساب`, 'بدون بطاقة بنكية — الدخول بحساب جوجل']
  },
  {
    code: 'student',
    title: 'باقة الطالب',
    tagline: 'مناسبة لأبحاث التخرج والمشاريع الصغيرة',
    price: 99,
    tokens: 50000,
    period: 'شهرياً',
    periodDays: 30,
    cta: 'اشترك الآن',
    popular: false,
    displayOrder: 2,
    roleCode: 'student',
    storageMb: PLAN_STORAGE_DEFAULT_MB,
    fileMaxMb: PLAN_FILE_DEFAULT_MB,
    features: ['النقاط تُستخدم في كل أدوات المنصة بلا استثناء']
  },
  {
    code: 'researcher',
    title: 'باقة الباحث',
    tagline: 'الأكثر اختياراً لرسائل الماجستير',
    price: 249,
    tokens: 150000,
    period: 'شهرياً',
    periodDays: 30,
    cta: 'اشترك الآن',
    popular: true,
    displayOrder: 3,
    roleCode: 'researcher',
    storageMb: PLAN_STORAGE_DEFAULT_MB,
    fileMaxMb: PLAN_FILE_DEFAULT_MB,
    features: ['ملف بحثي مخصص حسب مجالك وجامعتك واللغة المفضلة لديك']
  },
  {
    code: 'thesis',
    title: 'باقة الرسائل العلمية',
    tagline: 'مصممة لرسائل الدكتوراه والمشاريع الكبيرة',
    price: 449,
    tokens: 500000,
    period: 'شهرياً',
    periodDays: 30,
    cta: 'اشترك الآن',
    popular: false,
    displayOrder: 4,
    roleCode: 'thesis',
    storageMb: PLAN_STORAGE_DEFAULT_MB,
    fileMaxMb: PLAN_FILE_DEFAULT_MB,
    features: ['أولوية في الرد على استفساراتك خلال ساعات العمل']
  }
];

/**
 * حالات خطوة في مسار البحث — قيمها تُخزَّن في user_step_progress.status.
 * 'not_started' هي القيمة الافتراضية في قاعدة البيانات.
 */
export const STEP_STATUSES = [
  { value: 'not_started', label: 'لم يبدأ' },
  { value: 'in_progress', label: 'جاري' },
  { value: 'done', label: 'تم' }
];

/** حالات قراءة المرجع — قيمها تُخزَّن في user_references.status. */
export const READING_STATUSES = [
  { value: 'to_read', label: 'مرشّح للقراءة' },
  { value: 'reading', label: 'قيد القراءة' },
  { value: 'read', label: 'مقروء' },
  { value: 'cited', label: 'مُستخدم في البحث' }
];

/**
 * خدمات المنصة (features) — مصدر واحد لكل ما يعرض في الواجهة ويُمنع في المسارات.
 * كل خدمة مرتبطة بصلاحية واحدة في جدول role_permissions، وباقة الباحث تحدّد دوره،
 * فيفتح ما تسمح به صلاحيات ذلك الدور. «الدردشة» (المشرف الذكي) متاحة لكل الباقات.
 */
export const PLATFORM_SERVICES = [
  {
    key: 'chat',
    label: 'المشرف الذكي (الدردشة)',
    short: 'الدردشة',
    icon: 'message',
    href: '/chat',
    permission: 'chat:use',
    always: true,
    planFeature: 'محادثة كاملة مع المشرف الذكي (أفكار · منهجية · صياغة · مراجعة)',
    note: 'متاحة لكل الباقات — المشرف الذكي يجيب عن أسئلتك ويقترح المصادر.'
  },
  {
    key: 'voice',
    label: 'مناقشة صوتية عبر واتساب',
    short: 'الصوت',
    icon: 'phone',
    href: '/voice',
    permission: 'voice:use',
    always: true,
    planFeature: 'مناقشة صوتية مع المعلم عبر واتساب',
    note: 'مرتبطة برقم واتساب يُحدّده المدير حسب نوع الباحث (شاب/بنت).'
  },
  {
    key: 'journey',
    label: 'مسار البحث',
    short: 'المسار',
    icon: 'graduation',
    href: '/journey',
    permission: 'journey:edit',
    planFeature: 'مسار بحث متسلسل خطوة بخطوة (من الفكرة حتى المناقشة)',
    note: 'خطوات البحث من اختيار الموضوع حتى المناقشة.'
  },
  {
    key: 'library',
    label: 'المكتبة العلمية',
    short: 'المكتبة',
    icon: 'book',
    href: '/files',
    permission: 'library:browse',
    planFeature: 'المكتبة العلمية ومراجعها (بحث + مراجعك + توثيق APA)',
    note: 'مكتبة المنصة: مراجع وكتب يضيفها المدير ويقرأها كل الباحثين.'
  },
  {
    key: 'notes',
    label: 'المفكرة',
    short: 'المفكرة',
    icon: 'list',
    href: '/notes',
    permission: 'notes:use',
    planFeature: 'المفكرة وملاحظات البحث مرتبطة بخطوات المسار',
    note: 'ملاحظاتك ووسومك، مرتبطة بخطوات البحث.'
  },
  {
    key: 'files',
    label: 'رفع الملفات',
    short: 'الملفات',
    icon: 'clipboard',
    href: '/files',
    permission: 'files:upload',
    planFeature: 'رفع ملفاتك (فصول · ملفات Excel · مستندات) مع المعاينة والتحميل',
    note: 'مساحة تخزين شخصية لملفاتك وفصول رسالتك.'
  },
  {
    key: 'defense',
    label: 'المناقشة والتدريب عليها',
    short: 'المناقشة',
    icon: 'message',
    href: '/defense',
    permission: 'defense:train',
    planFeature: 'محاكاة المناقشة: أسئلة اللجنة ثم تقييم ونقاط الضعف',
    note: 'محاكاة مناقشة حقيقية بعد انتهاء البحث — أسئلة متدرجة ثم تقييم ونقاط الضعف.'
  }
];

/**
 * أدوار النظام: دور لكل باقة + المشرف + مدير المنصة.
 * الباقة تحدّد الدور (plans.role_code)، والدور يحدد الخدمات المفتوحة عبر صلاحياته.
 * level يُستخدم للمقارنة («هذا الدور لا يقل عن X»).
 */
export const DEFAULT_ROLES = [
  {
    code: 'free',
    title: 'باقة مجانية',
    level: 0,
    permissions: ['dashboard:view', 'chat:use', 'journey:edit', 'notes:use']
  },
  {
    code: 'researcher',
    title: 'باحث',
    level: 1,
    permissions: ['dashboard:view', 'chat:use', 'journey:edit', 'library:browse', 'notes:use', 'files:upload']
  },
  {
    code: 'student',
    title: 'طالب جامعي',
    level: 1,
    permissions: ['dashboard:view', 'chat:use', 'journey:edit', 'library:browse', 'notes:use', 'files:upload']
  },
  {
    code: 'thesis',
    title: 'رسائل علمية',
    level: 2,
    permissions: [
      'dashboard:view',
      'chat:use',
      'journey:edit',
      'library:browse',
      'notes:use',
      'files:upload',
      'defense:train'
    ]
  },
  {
    code: 'supervisor',
    title: 'مشرف إداري',
    level: 3,
    // صلاحياته كلّها في لوحة الإدارة: يفتحها المدير له ويمنعها عنه وقتاً يشاء.
    // وما ليس هنا (إضافة مشرف أو مدير، حدود التخزين، إعدادات الموقع) فمreservation للمدير وحده.
    permissions: [
      'dashboard:view',
      'admin:panel',
      'admin:users',
      'admin:library',
      'admin:usage',
      'admin:payments'
    ]
  },
  { code: 'admin', title: 'مدير المنصة', level: 9, permissions: ['*'] }
];

/**
 * صلاحيات لوحة الإدارة — كل صلاحية تخصّ مجموعة صفحات.
 * دور admin يملك '*' (كل شيء)، والمشرف الإداري لا يملك سوى ماختاره المدير له من هنا،
 * وصفحة الإعدادات (حدود التخزين + المشرفون) ما زالت للمدير وحده ولا تُمنح بالمعطيات.
 */
export const ADMIN_PERMISSIONS = [
  { key: 'admin:panel', label: 'دخول لوحة الإدارة', hint: 'بلا هذه لا يفتح السايدبار ولا أي صفحة إدارة.' },
  { key: 'admin:users', label: 'إدارة الباحثين', hint: 'البحث والفلترة والإيقاف والمنح والتغيير وحذف الحسابات.' },
  { key: 'admin:library', label: 'المكتبة العلمية', hint: 'رفع الكتب واستيرادها من المصادر وتعديلها وحذفها.' },
  { key: 'admin:plans', label: 'الباقات والأدوار', hint: 'إضافة وتعديل الباقات وربط كل باقة بدورها.' },
  { key: 'admin:roles', label: 'الأدوار والصلاحيات', hint: 'تعديل صلاحيات الأدوار (مهمّة حسّاسة).' },
  { key: 'admin:usage', label: 'الاستهلاك والإحصاءات', hint: 'سجل الاستهلاك ومخططات المنصة.' },
  { key: 'admin:payments', label: 'تأكيد طلبات الدفع', hint: 'مراجعة طلبات الاشتراك وتأكيدها (تُفعّل الباقة والنقاط) أو رفضها.' },
  { key: 'admin:notify', label: 'إرسال الإشعارات', hint: 'إشعار فوري لكل الباحثين.' }
];

/**
 * حدود رفع ملفات الباحث — الافتراضي فقط؛ الحد الفعلي يضبطه المدير من
 * لوحة الإدارة (/admin/settings) عبر services/settings.js (جدول settings).
 * الأنواع المسموحة تُطبَّق دائماً من هذه القائمة.
 */
export const FILE_UPLOAD_LIMITS = {
  // Fallback فقط حين لا يوجد إعداد في جدول settings ولا في .env
  maxMb: 100,
  allowedExtensions: [
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'ppt', 'pptx', 'zip', 'jpg', 'jpeg', 'png', 'webp'
  ],
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'text/markdown',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
};

/** إعدادات المنصة الافتراضية — تُزرع في جدول settings */
export const DEFAULT_SETTINGS = [
  ['site_name', APP_NAME],
  ['support_email', SUPPORT_EMAIL],
  ['support_whatsapp', SUPPORT_WHATSAPP]
];

/** عملات المنصة المدعومة — واحدة تُختار من الإعدادات (site_currency). */
export const SITE_CURRENCIES = [
  { code: 'LYD', label: 'دينار ليبي', symbol: 'د.ل', short: 'د.ل' },
  { code: 'USD', label: 'دولار أمريكي', symbol: '$', short: '$' }
];

/** كود العملة الافتراضي (السقوط الآمن إن لم يوجد إعداد). */
export const DEFAULT_CURRENCY = 'LYD';

/**
 * طرق الدفع اليدوية (خارج المنصة: تحويل بنكي أو محفظة أو دفع نقدي).
 * المصدر الحقيقي جدول payment_methods (يضبطه المدير من الإعدادات)،
 * وهذه قائمة سقوط آمنة تظهر لو لم تُضبط بعد.
 */
/**
 * طرق الدفع اليدوية الثابتة (لا يضبطها المدير — هاتان الطريقتان فقط):
 * 1. تحويل بنكي  2. كاش.
 * الباحث لا يكتب رقم عملية ولا يرسل ملاحظة: ينشأ النظام كود تفعيل من 6 أرقام
 * يظهر للباحث ويرسله عبر واتساب لخدمة العملاء لتفعيل باقته.
 */
export const DEFAULT_PAYMENT_METHODS = [
  {
    code: 'bank_transfer',
    label: 'حواله مصرفيه',
    note: 'حوّل المبلغ إلى الحساب البنكي الموّحد، ثم أرسل كود التفعيل عبر واتساب لخدمة العملاء.',
    details: '',
    currency: 'LYD',
    ready: true
  },
  {
    code: 'cash_office',
    label: 'كاش',
    note: 'ادفع نقداً في المكتب المعتمد، ثم أرسل كود التفعيل عبر واتساب لخدمة العملاء.',
    details: '',
    currency: 'LYD',
    ready: true
  }
];

/** طرق الدفع القديمة (نُبقيها للصفحة العامة لو أُهملت القائمة الجديدة). */
export const PAYMENT_METHODS = DEFAULT_PAYMENT_METHODS.map((item) => ({ name: item.label, note: item.note, ready: item.ready }));
