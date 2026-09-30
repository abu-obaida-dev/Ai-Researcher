/**
 * ثوابت المنصة المشتركة بين الخادم وكل الصفحات المولَّدة على الخادم.
 * منقولة كما هي من النسخة القديمة (React) في المجلد backup لتبقى نصوص المنصة
 * وأسعارها وقوائمها متطابقة، مع تعديل اسم الهوية إلى Zena AI فقط.
 */

export const APP_NAME = 'Zena AI';
export const APP_TAGLINE = 'مساعدك البحثي الذكي';
export const SUPPORT_EMAIL = 'support@moshrefai.com';
export const SUPPORT_WHATSAPP = '01000000000';

/** التوكنز الممنوحة مجاناً لكل باحث جديد (سقوط آمن إن تعذّرت قراءة الباقة المجانية) */
export const FREE_TRIAL_TOKENS = 10000;

/** كود الباقة المجانية في جدول plans */
export const FREE_PLAN_CODE = 'free_trial';

export const TOKEN_COSTS = [
  { type: 'chat', label: 'رسالة إلى المشرف الذكي', tokens: 30, description: 'سؤال أو استفسار مع رد علمي مفصّل' },
  { type: 'translate', label: 'ترجمة وصياغة أكاديمية', tokens: 60, description: 'ترجمة عربي/إنجليزي بصياغة علمية' },
  { type: 'outline', label: 'بناء خطة وهيكل بحث', tokens: 80, description: 'تقسيم الفصول والمحاور والأهداف' },
  { type: 'sources', label: 'اقتراح مصادر ومراجع', tokens: 120, description: 'قائمة مراجع مع توثيق APA' },
  { type: 'review', label: 'مراجعة فصل أو مقطع', tokens: 150, description: 'مراجعة منهجية ولغوية مع ملاحظات تفصيلية' }
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

/** التخصصات المعروضة كأزرار في نموذج التسجيل — نسخة مختصرة من مجالات البحث */
export const SPECIALIZATIONS = [
  'أخرى', 'القانون', 'الطب', 'الهندسة', 'الاقتصاد', 'الإدارة', 'العلوم الإنسانية',
  'تقنية المعلومات', 'التربية', 'علم النفس', 'علوم الحاسب', 'اللغات والترجمة', 'العمارة',
  'العلوم الاجتماعية', 'العلوم التطبيقية'
];

/** ما يريد الباحث إنجازه الآن — يحدد مرحلة الإشراف التي يبدأ منها */
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

/** حالة تقدّم المشروع البحثي */
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

/** روابط التنقل في الصفحة العامة */
export const PUBLIC_NAV = [
  { href: '/#features', label: 'المميزات' },
  { href: '/#how', label: 'كيف تعمل' },
  { href: '/#pricing', label: 'الباقات' },
  { href: '/#faq', label: 'الأسئلة الشائعة' }
];

/**
 * الباقات الافتراضية — مصدر واحد مزدوج الاستخدام:
 * 1) بذرة جدول plans عند تنفيذ npm run db:seed.
 * 2) سقوط آمن لعرض صفحة الهبوط إذا تعذّرت قراءة قاعدة البيانات.
 * حقل features يُخزَّن في قاعدة البيانات كنص بأسطر متعددة.
 */
export const DEFAULT_PLANS = [
  {
    code: 'free_trial',
    title: 'التجربة المجانية',
    tagline: 'ابدأ الإشراف البحثي بلا التزام',
    price: 0,
    tokens: FREE_TRIAL_TOKENS,
    period: 'مرة واحدة عند التسجيل',
    cta: 'ابدأ مجاناً',
    popular: false,
    displayOrder: 1,
    features: [
      `${FREE_TRIAL_TOKENS.toLocaleString('en-US')} توكن مجاناً عند إنشاء الحساب`,
      'محادثة مع المشرف البحثي الذكي',
      'اقتراح عناوين وأفكار وفرضيات بحثية',
      'ملف بحثي مخصص حسب مجالك وجامعتك',
      'بدون بطاقة بنكية'
    ]
  },
  {
    code: 'student',
    title: 'باقة الطالب',
    tagline: 'مناسبة لأبحاث التخرج والمشاريع الصغيرة',
    price: 99,
    tokens: 50000,
    period: 'شهرياً',
    cta: 'اشترك الآن',
    popular: false,
    displayOrder: 2,
    features: [
      '50,000 توكن شهرياً',
      'كل مزايا التجربة المجانية',
      'بناء هيكل البحث وتقسيم الفصول',
      'تدقيق لغوي وصياغة أكاديمية',
      'دعم عبر البريد خلال 24 ساعة'
    ]
  },
  {
    code: 'researcher',
    title: 'باقة الباحث',
    tagline: 'الأكثر اختياراً لرسائل الماجستير',
    price: 249,
    tokens: 150000,
    period: 'شهرياً',
    cta: 'اشترك الآن',
    popular: true,
    displayOrder: 3,
    features: [
      '150,000 توكن شهرياً',
      'كل مزايا باقة الطالب',
      'مراجعة منهجية لفصول البحث',
      'اقتراح المصادر وتوثيقها بنظام APA',
      'تحليل الدراسات السابقة (Literature Review)',
      'أولوية في الدعم الفني'
    ]
  },
  {
    code: 'thesis',
    title: 'باقة الرسائل العلمية',
    tagline: 'مصممة لرسائل الدكتوراه والمشاريع الكبيرة',
    price: 449,
    tokens: 500000,
    period: 'شهرياً',
    cta: 'اشترك الآن',
    popular: false,
    displayOrder: 4,
    features: [
      '500,000 توكن شهرياً',
      'كل مزايا باقة الباحث',
      'متابعة كاملة لرسالة الماجستير أو الدكتوراه',
      'توليد أسئلة المناقشة والردود عليها',
      'تقارير تحسين الصياغة والاتساق',
      'دعم مخصص وبريد مباشر مع الفريق'
    ]
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
 * أدوار النظام (بذرة جدول roles — تفعيلها في الـ middleware يأتي مع المرحلة الثانية).
 * level يُستخدم للمقارنة («هذا الدور لا يقل عن X») عند تفعيل requireRole.
 */
export const DEFAULT_ROLES = [
  { code: 'user', title: 'مستخدم', level: 0, permissions: ['dashboard:view', 'chat:use'] },
  { code: 'researcher', title: 'باحث', level: 1, permissions: ['dashboard:view', 'chat:use', 'journey:edit', 'library:browse'] },
  { code: 'supervisor', title: 'مشرف أكاديمي', level: 2, permissions: ['dashboard:view', 'chat:use', 'journey:edit', 'library:browse', 'students:view'] },
  { code: 'admin', title: 'مدير المنصة', level: 9, permissions: ['*'] }
];

/**
 * حدود رفع ملفات الباحث — تُطبَّق في services/files.js وفي نص نموذج الرفع.
 * maxBytes يُقرأ من البيئة عند النداء (بعد تحميل dotenv في server.js) لا عند الاستيراد.
 */
export const FILE_UPLOAD_LIMITS = {
  maxMb: Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 10),
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

/** الطرق المتاحة للدفع (تُعرض في الصفحة العامة) */
export const PAYMENT_METHODS = [
  { name: 'إنستاباي', note: 'تحويل فوري من أي بنك', ready: true },
  { name: 'فودافون كاش', note: 'محفظة إلكترونية', ready: true },
  { name: 'بطاقة بنكية', note: 'قريباً مع بوابة الدفع الإلكتروني', ready: false }
];
