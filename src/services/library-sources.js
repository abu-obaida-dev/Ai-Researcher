import { LIBRARY_EXTENSIONS, LIBRARY_MAX_FILE_BYTES, stripHtml } from './library.js';

/**
 * جلب المكتبة من مصادر مرجعية مجانية بلا مفاتيح (P3):
 *   - كتب: Open Library (+ تنزيل من Internet Archive).
 *   - مقالات مفتوحة: DOAJ · Zenodo · arXiv · Europe PMC (علوم طبية).
 *   - قواعد بيانات الاستشهادات: Crossref (أغنى بيانات استشهاد) · OpenAlex
 *     (يفهرس IEEE وACM والSpringer وElsevier ويعطي رابط PDF مفتوح) ·
 *     Semantic Scholar (ملخصات واستشهادات).
 *   - IEEE Xplore و ACM Digital Library: يُبحث عنهما عبر Crossref ببادئة DOI
 *     (10.1109 لـ IEEE و 10.1145 لـ ACM) فيعود الرابط الرسمي + رابط PDF مفتوح
 *     إن وُجد — بلا خرقة شروط ولا محاكاة لزاحفة Google Scholar.
 *   - دقة إضافية: Unpaywall (رابط قانوني للنسخة المفتوحة من أي DOI) +
 *     حلّ DOI (doi.org) لتحويل أي رابط أو DOI إلى بيانات مرجعية كاملة.
 *
 * كل النداءات JSON/Atom بلا مفاتيح إلزامية، مع مهلة زمنية وسقف حجم
 * وحارس روابط داخلية (SSRF).
 */

const USER_AGENT = 'ZenaAI-Library/1.0 (central research library import)';
const SEARCH_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 60000;

/** بريد التواصل المطلوب من Unpaywall (شرط الخدمة المجانية). */
const UNPAYWALL_EMAIL = String(process.env.UNPAYWALL_EMAIL || process.env.SUPPORT_EMAIL || 'support@moshrefai.com').trim();

/** بادئات DOI الرسمية للناشرين (Crossref members). */
const PUBLISHER_PREFIXES = {
  ieee: '10.1109',
  acm: '10.1145'
};

/**
 * مجموعات بادئات ناشرين عالميين — بحث مجاني عبر Crossref مباشرة (بلا مفاتيح API).
 * متحقَّق حيّاً من /members ومن عينات /works: Crossref يقبل تكرار المفتاح
 * (prefix:10.1002,prefix:10.1111) لكن لا يقبل عدة قيم لمفتاح واحد.
 *   - Springer (10.1007) · Nature (10.1038) · BMC (10.1186) — عائلة Springer Nature
 *   - Wiley (10.1002) · Blackwell (10.1111 · 10.1046) · Hindawi (10.1155)
 *   - Taylor & Francis (10.1080 — Informa UK) · SAGE (10.1177)
 */
const PUBLISHER_PREFIX_SETS = {
  springer: ['10.1007', '10.1038', '10.1186'],
  wiley: ['10.1002', '10.1111', '10.1046', '10.1155'],
  tandf: ['10.1080'],
  sage: ['10.1177'],
  ssrn: ['10.2139'] // SSRN (Elsevier) — موثّق حيّاً: 1.5 مليون ورقة اقتصادية وقانونية
};

/** هل هذا المعرّف DOI؟ (يقبل الرابط الكامل أو 10.x/y) */
function isDoi(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/i.test(raw);
}

/** يستخرج DOI من نص حر (رابط doi.org أو نص داخل اقتباس) — محارف DOI المعروفة فقط. */
export function extractDoi(text) {
  const raw = String(text || '');
  const match = raw.match(/10\.\d{4,9}\/[A-Za-z0-9._;()/:+*#[\]-]+/);
  return match ? match[0].replace(/[.,;)]+$/, '') : '';
}

/** رابط بحث Google Scholar للباحث (فتح يدوي — لا خرقة ولا scraping). */
export function googleScholarUrl(query) {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(String(query || '').trim())}`;
}

/** رابط landing رسمي لناشر معروف من DOI (Xplore / ACM DL). */
export function publisherLandingUrl(doi) {
  const raw = String(doi || '')
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');

  if (!raw) return '';

  if (raw.startsWith(PUBLISHER_PREFIXES.acm)) return `https://dl.acm.org/doi/${raw}`;

  if (raw.startsWith(PUBLISHER_PREFIXES.ieee)) {
    // معرّف Xplore هو الرقم في DOI (مثل 9181037)، لا بقية السلسلة النصية.
    const id = raw.match(/(\d{5,})(?:\/|$)/)?.[1] || '';
    return id ? `https://ieeexplore.ieee.org/document/${id}` : `https://doi.org/${raw}`;
  }

  return `https://doi.org/${raw}`;
}

/** المصادر المتاحة في نموذج الجلب (id يُستخدم في الروابط والفلترة). */
export const LIBRARY_SOURCES = [
  {
    id: 'crossref',
    label: 'Crossref — المصدر الرسمي لبيانات الاستشهاد',
    hint: 'أصح بيانات استشهاد: مجلة · دار نشر · DOI · مجلد · عدد · صفحات. تغطي أغلب الناشرين.'
  },
  {
    id: 'openalex',
    label: 'OpenAlex — فهرس علمي مفتوح',
    hint: 'يفهرس IEEE وACM وSpringer وElsevier، ويكشف النسخة المفتوحة (PDF) إن وُجدت.'
  },
  {
    id: 'ieee',
    label: 'IEEE Xplore — أوراق ومجلات IEEE',
    hint: 'أوراق IEEE الرسمية عبر بادئة DOI (10.1109) مع رابط Xplore ونسخة PDF مفتوحة إن وُجدت.'
  },
  {
    id: 'acm',
    label: 'ACM Digital Library — أوراق ACM',
    hint: 'أوراق ACM الرسمية (قواعد البيانات · ذكاء اصطناعي · HCI) عبر بادئة DOI (10.1145).'
  },
  {
    id: 'semantic',
    label: 'Semantic Scholar — بحث دلالي',
    hint: 'بحث بالمعنى مع ملخصات وعدد الاستشهادات ومعرّفات DOI/arXiv.'
  },
  {
    id: 'arxiv',
    label: 'arXiv — مسودات علمية (preprint)',
    hint: 'مسودات preprint مفتوحة بالكامل في علوم الحاسوب والذكاء الاصطناعي والفيزياء — PDF مباشر.'
  },
  {
    id: 'europepmc',
    label: 'Europe PMC — الطب والعلوم الحيوية',
    hint: 'مراجع طبية وبيولوجية مع روابط النص الكامل المفتوح (PubMed Central).'
  },
  {
    id: 'openlibrary',
    label: 'Open Library — كتب مجانية',
    hint: 'كتب بالعنوان أو المؤلف أو التصنيف — يُحمَّل الكتاب من Internet Archive عند توفره.'
  },
  {
    id: 'doaj',
    label: 'DOAJ — أبحاث مفتوحة الوصول',
    hint: 'مقالات من مجلات مفتوحة مع تصنيفات علمية وتحميل PDF متاح.'
  },
  {
    id: 'zenodo',
    label: 'Zenodo — منشورات بحثية',
    hint: 'منشورات CERN المفتوحة: أوراق وملفات بحثية بصيغة PDF.'
  },
  {
    id: 'springer',
    label: 'Springer — دار Springer',
    hint: 'مجلات Springer وNature وBMC عبر بادئات DOI (10.1007 · 10.1038 · 10.1186) — بيانات استشهاد كاملة ورابط الناشر.'
  },
  {
    id: 'wiley',
    label: 'Wiley — دار Wiley',
    hint: 'مجلات Wiley وBlackwell وHindawi عبر بادئات DOI (10.1002 · 10.1111 · 10.1046 · 10.1155).'
  },
  {
    id: 'tandf',
    label: 'Taylor & Francis — دوريات Taylor & Francis',
    hint: 'مجلات Taylor & Francis عبر بادئة DOI (10.1080).'
  },
  {
    id: 'sage',
    label: 'SAGE — دوريات SAGE',
    hint: 'مجلات SAGE (اجتماعية · إدارة · طب) عبر بادئة DOI (10.1177).'
  },
  {
    id: 'unpaywall',
    label: 'Unpaywall — نصوص PDF مفتوحة قانونياً',
    hint: 'بحث واسع ثم تحقّق من نسخة PDF مفتوحة لكل DOI عبر Unpaywall — رابط النص الكامل عند توفره.'
  },
  {
    id: 'internetarchive',
    label: 'Internet Archive — أرشيف الإنترنت',
    hint: 'ملايين الكتب والوثائق المرقمنة عالمياً وعربياً — تحميل الكتاب كاملاً عند توفره.'
  },
  {
    id: 'loc',
    label: 'مكتبة الكونجرس (LOC) — كتب ومخطوطات',
    hint: 'سجلات مكتبة الكونجرس الرسمية عبر SRU: كتب ومخطوطات ووثائق تاريخية (منها WDL).'
  },
  {
    id: 'core',
    label: 'CORE — أبحاث مفتوحة الوصول',
    hint: 'أضخم تجميع عالمي للأبحاث مفتوحة الوصول مع نصوص كاملة — يحتاج مفتاحاً مجانياً (CORE_API_KEY).'
  },
  {
    id: 'pmc',
    label: 'PubMed Central — الطب مفتوح النصوص',
    hint: 'أرشيف NCBI الطبي للنصوص الكاملة عبر E-utilities الرسمية — بلا مفتاح، مع DOI للمقال.'
  },
  {
    id: 'hal',
    label: 'HAL — الأرشيف العلمي المفتوح',
    hint: 'مقالات ومسودات أوروبية عبر HAL (فرنسا) مع رابط PDF مباشر وملخصات — بلا مفتاح.'
  },
  {
    id: 'base',
    label: 'BASE — محرك بحث أكاديمي ألماني',
    hint: 'ملايين الأوراق من مستودعات العالم — يحتاج تسجيلاً مجانياً (BASE_API_USER / BASE_API_PASS).'
  },
  {
    id: 'ssrn',
    label: 'SSRN — أبحاث اقتصادية وقانونية',
    hint: 'شبكة العلوم الاجتماعية (Elsevier) عبر بادئة DOI (10.2139) — أكثر من مليون ورقة أعمال ومسودة.'
  },
  {
    id: 'toubkal',
    label: 'Toubkal — مستودع الجامعات المغربية (محمد الخامس وغيرهما)',
    hint: 'أطروحات ومقالات المستودع الرقمي Toubkal (DSpace) لجامعة محمد الخامس وجامعة محمد الأول — بلا مفتاح، مع تحميل الملف الأصلي عند توفره.'
  }
];

/**
 * مجموعات المصادر في واجهة البحث — تقسيم القائمة المنسدلة لسهولة الاختيار
 * (عالمية · تخصصية · ناشرون · كتب ومراجع عربية وعالمية).
 */
export const SOURCE_GROUPS = [
  { id: 'global', label: 'أبحاث ودوريات عالمية' },
  { id: 'specialized', label: 'أبحاث تخصصية (هندسة · حاسوب · طب · اقتصاد وقانون)' },
  { id: 'publishers', label: 'دوريات الناشرين العالميين' },
  { id: 'books', label: 'كتب ومراجع عربية وعالمية' },
  { id: 'arabic', label: 'مستودعات وبوابات عربية' }
];

/** مجموعة مصدر في الواجهة (يُرجع '' للمصدر غير المعروف فلا يظهر في القائمة). */
export function sourceGroup(id) {
  const groups = {
    crossref: 'global',
    openalex: 'global',
    semantic: 'global',
    doaj: 'global',
    zenodo: 'global',
    unpaywall: 'global',
    core: 'global',
    ieee: 'specialized',
    acm: 'specialized',
    arxiv: 'specialized',
    europepmc: 'specialized',
    springer: 'publishers',
    wiley: 'publishers',
    tandf: 'publishers',
    sage: 'publishers',
    openlibrary: 'books',
    internetarchive: 'books',
    loc: 'books',
    pmc: 'specialized',
    hal: 'global',
    base: 'global',
    ssrn: 'specialized',
    toubkal: 'arabic'
  };
  return groups[String(id || '')] || '';
}

/** اسم مصدر للعرض. */
export function sourceLabel(id) {
  return LIBRARY_SOURCES.find((item) => item.id === id)?.label || String(id || '');
}

/** حارس بسيط لمنع الروابط الداخلية/الخاصة (SSRF) قبل أي نداء خارجي. */
function assertPublicUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    const error = new Error('رابط غير صالح.');
    error.code = 'BAD_URL';
    throw error;
  }

  const host = parsed.hostname.toLowerCase();
  const blocked =
    parsed.protocol !== 'https:' && parsed.protocol !== 'http:'
      ? true
      : host === 'localhost' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.endsWith('.lan') ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) {
    const error = new Error('الرابط يشير إلى شبكة داخلية — مرفوض.');
    error.code = 'BAD_URL';
    throw error;
  }
  return parsed;
}

/** جلب JSON بمهلة وحدّ حجم. */
async function fetchJson(url, { timeoutMs = SEARCH_TIMEOUT_MS, maxBytes = 5 * 1024 * 1024 } = {}) {
  assertPublicUrl(url);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
  });
  if (!response.ok) {
    const error = new Error(`المصدر ردّ بحالة ${response.status}.`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    const error = new Error('ردّ المصدر أكبر من الحد المسموح.');
    error.code = 'TOO_LARGE';
    throw error;
  }
  return JSON.parse(buffer.toString('utf8'));
}

/** جلب ملف بايتات: يتحقق من الحالة والسقف قبل وبعد القراءة. */
async function fetchBytes(url, { maxBytes = LIBRARY_MAX_FILE_BYTES } = {}) {
  assertPublicUrl(url);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT }
  });
  if (!response.ok) {
    const error = new Error(`تعذّر تنزيل الملف (حالة ${response.status}).`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    const error = new Error('حجم الملف أكبر من 200 ميجابايت.');
    error.code = 'TOO_LARGE';
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    const error = new Error('حجم الملف أكبر من 200 ميجابايت.');
    error.code = 'TOO_LARGE';
    throw error;
  }
  if (!buffer.length) {
    const error = new Error('الملف فارغ.');
    error.code = 'BAD_FILE';
    throw error;
  }
  return buffer;
}

/** نوع المحتوى المناسب للامتداد. */
function mimeForExtension(extension) {
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'epub') return 'application/epub+zip';
  if (extension === 'txt' || extension === 'md') return 'text/plain';
  if (extension === 'zip') return 'application/zip';
  return 'application/octet-stream';
}

/** الامتداد من اسم ملف خارجي أو من الرابط — ضمن القائمة المسموحة وإلا null. */
function allowedExtensionFrom(nameOrUrl) {
  const match = /\.([A-Za-z0-9]{1,8})(?:[?#]|$)/.exec(String(nameOrUrl || ''));
  const extension = match ? match[1].toLowerCase() : '';
  return LIBRARY_EXTENSIONS.includes(extension) ? extension : null;
}

/** فحص بصري للبايتات: PDF يبدأ بـ %PDF و EPUB/ZIP يبدأ بـ PK — يمنع حفظ HTML كملف. */
function verifyMagic(extension, buffer) {
  if (extension === 'pdf') return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (extension === 'epub' || extension === 'zip') return buffer.subarray(0, 2).toString('latin1') === 'PK';
  return true;
}

/** رسالة خطأ عربية موجزة لكل كود. */
function sourceErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'TIMEOUT' || code === 'ABORT_ERR' || error?.name === 'TimeoutError') {
    return 'انتهت مهلة الاتصال بالمصدر — حاول مرة أخرى.';
  }
  if (code === 'SOURCE_HTTP') return error.message || 'المصدر رفض الطلب — حاول لاحقاً.';
  if (code === 'BAD_URL') return 'رابط غير صالح أو يشير إلى شبكة داخلية — مرفوض.';
  if (code === 'TOO_LARGE') return error.message || 'الملف أكبر من السقف المسموح (200MB).';
  return 'تعذّر الوصول إلى المصدر الآن — تحقق من الشبكة وحاول مجدداً.';
}

/** بحث في Open Library (كتب + تصنيفات + مؤشر Archive للتحميل). */
async function searchOpenLibrary({ q, subject, limit }) {
  const params = new URLSearchParams({
    limit: String(limit),
    fields: ['key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'subject', 'ia', 'publisher'].join(',')
  });
  if (subject) params.set('subject', subject);
  if (q) params.set('q', q);

  const data = await fetchJson(`https://openlibrary.org/search.json?${params.toString()}`);
  return (Array.isArray(data.docs) ? data.docs : []).map((doc) => {
    const iaId = Array.isArray(doc.ia) && doc.ia.length ? String(doc.ia[0]) : '';
    return {
      key: iaId ? `ia:${iaId}` : `work:${doc.key || ''}`,
      title: [doc.title, doc.subtitle].filter(Boolean).join(': ') || '(بدون عنوان)',
      authors: (Array.isArray(doc.author_name) ? doc.author_name : []).slice(0, 4).join('، '),
      year: Number.isInteger(doc.first_publish_year) ? doc.first_publish_year : null,
      source: (Array.isArray(doc.publisher) ? doc.publisher : [])[0] || 'Open Library',
      abstract: '',
      subjects: (Array.isArray(doc.subject) ? doc.subject : []).slice(0, 6).join(' · '),
      url: `https://openlibrary.org${doc.key || ''}`,
      downloadable: Boolean(iaId),
      locator: iaId ? `ia:${iaId}` : `work:${doc.key || ''}`
    };
  });
}

/**
 * رابط PDF لمقالة DOAJ.
 * الاستجابة الحالية تضع الروابط في bibjson.link ({ content_type, type, url })
 * مع الحقل القديم best_oa_location.url_for_pdf ما زال موجوداً في بعض السجلات،
 * فنقرأ الاثنين ونفضّل PDF المباشر على رابط النص الكامل.
 */
function doajPdfUrl(bibjson) {
  const links = Array.isArray(bibjson.link) ? bibjson.link.filter((link) => link?.url) : [];
  const direct = links.find((link) => String(link.content_type || '').toLowerCase() === 'pdf');
  const fullText = links.find((link) => String(link.type || '').toLowerCase() === 'fulltext');
  return String(direct?.url || bibjson.best_oa_location?.url_for_pdf || fullText?.url || '');
}

/** بحث في DOAJ (مقالات مفتوحة الوصول مع تصنيفات ورابط PDF إن وُجد). */
async function searchDoaj({ q, subject, limit }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const data = await fetchJson(
    `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=${Math.min(limit, 25)}`
  );

  return (Array.isArray(data.results) ? data.results : []).map((row) => {
    const bibjson = row.bibjson || {};
    const pdfUrl = doajPdfUrl(bibjson);
    const yearMatch = /^\d{4}$/.test(String(bibjson.year || '')) ? Number(bibjson.year) : null;
    return {
      key: String(row.id || ''),
      title: bibjson.title || '(بدون عنوان)',
      authors: (Array.isArray(bibjson.author) ? bibjson.author : [])
        .map((author) => author?.name)
        .filter(Boolean)
        .slice(0, 4)
        .join('، '),
      year: yearMatch,
      source: bibjson.journal?.title || bibjson.publisher?.name || 'DOAJ',
      abstract: stripHtml(bibjson.abstract || ''),
      subjects: (Array.isArray(bibjson.subject) ? bibjson.subject : [])
        .map((entry) => entry?.term)
        .filter(Boolean)
        .slice(0, 6)
        .join(' · '),
      url: `https://doaj.org/articles/${row.id || ''}`,
      downloadable: Boolean(pdfUrl),
      locator: pdfUrl
    };
  });
}

/** بحث في Zenodo (منشورات بحثية مفتوحة مع ملفات مباشرة). */
async function searchZenodo({ q, subject, limit }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const data = await fetchJson(`https://zenodo.org/api/records?q=${encodeURIComponent(query)}&size=${limit}`);

  return (data.hits?.hits || []).map((record) => {
    const meta = record.metadata || {};
    const fileFlag =
      record.files && typeof record.files === 'object' && !Array.isArray(record.files)
        ? record.files.enabled !== false
        : Array.isArray(record.files) && record.files.length > 0;

    return {
      key: String(record.id || ''),
      title: meta.title || '(بدون عنوان)',
      authors: (Array.isArray(meta.creators) ? meta.creators : [])
        .map((creator) => creator?.name)
        .filter(Boolean)
        .slice(0, 4)
        .join('، '),
      year: /^\d{4}/.test(String(meta.publication_date || ''))
        ? Number(String(meta.publication_date).slice(0, 4))
        : null,
      source: meta.publisher || 'Zenodo',
      abstract: stripHtml(meta.description || ''),
      subjects: [
        ...(Array.isArray(meta.subjects) ? meta.subjects.map((entry) => entry?.term) : []),
        ...(Array.isArray(meta.keywords) ? meta.keywords : [])
      ]
        .filter(Boolean)
        .slice(0, 6)
        .join(' · '),
      url: record.links?.html || `https://zenodo.org/records/${record.id || ''}`,
      downloadable: fileFlag,
      locator: String(record.id || '')
    };
  });
}

/**
 * بحث في Internet Archive — ملايين الكتب والوثائق المرقمنة (منها ضخامة
 * المحتوى العربي: كتب ومخطوطات وصحف) بلا مفتاح. النتيجة «كتاب» بعنوان
 * ومؤلف وسنة، والتنزيل لاحقاً عبر downloadFromArchiveOrg بنفس مؤشر ia:.
 */
async function searchInternetArchive({ q, subject, limit }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams({
    q: `${query} AND mediatype:texts`,
    rows: String(Math.min(Number(limit) || 20, 25)),
    page: '1',
    output: 'json'
  });
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'creator');
  params.append('fl[]', 'date');
  params.append('fl[]', 'year');
  params.append('fl[]', 'publisher');

  const data = await fetchJson(`https://archive.org/advancedsearch.php?${params.toString()}`);
  return (Array.isArray(data?.response?.docs) ? data.response.docs : []).map((doc) => {
    const id = String(doc.identifier || '');
    const rawYear = String(doc.year || doc.date || '');
    return {
      key: id,
      title: stripHtml([].concat(doc.title || [])[0] || '(بدون عنوان)'),
      authors: [].concat(doc.creator || []).filter(Boolean).slice(0, 4).join('، '),
      year: Number(rawYear.slice(0, 4)) || null,
      source: 'Internet Archive',
      abstract: '',
      subjects: '',
      url: `https://archive.org/details/${id}`,
      downloadable: Boolean(id),
      locator: `ia:${id}`
    };
  });
}

/**
 * مكتبة الكونجرس (LOC) عبر بوابتها الرسمية SRU (CQL → XML/DC) — بلا مفتاح.
 * واجهة loc.gov JSON محجوبة بـ Cloudflare عن بعض شبكات الخوادم، أما SRU
 * (lx2.loc.gov:210) فيستقبل النداءات كما هي — كتب ومخطوطات ووثائق تاريخية
 * (منها مجموعة المكتبة الرقمية العالمية WDL المدمجة في LOC). حدّ SRU أقصاه 10 سجلات.
 */
async function searchLibraryOfCongress({ q, subject, limit }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const url = `http://lx2.loc.gov:210/lcdb?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(
    query
  )}&maximumRecords=${Math.min(Math.max(Number(limit) || 10, 1), 10)}&recordSchema=dc`;
  assertPublicUrl(url);

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/xml, text/xml' }
  });
  if (!response.ok) {
    const error = new Error(`مكتبة الكونجرس ردّت بحالة ${response.status}.`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const xml = Buffer.from(await response.arrayBuffer()).toString('utf8');
  return xml
    .split('<srw_dc:dc')
    .slice(1)
    .map((chunk) => {
      const grabAll = (tag) =>
        [...chunk.matchAll(new RegExp(`<(?:dc:)?${tag}[^>]*>([\\s\\S]*?)</(?:dc:)?${tag}>`, 'g'))]
          .map((match) => stripHtml(match[1]).trim())
          .filter(Boolean);
      const title = (grabAll('title')[0] || '(بدون عنوان)').replace(/\s*\/\s*$/, '');
      const date = grabAll('date')[0] || '';
      const ids = grabAll('identifier');
      const httpId = ids.find((value) => /^https?:\/\//.test(value)) || '';
      const lccn = ids.find((value) => /^[\d-]{4,}$/.test(value)) || '';
      const permalink = httpId || (lccn ? `https://lccn.loc.gov/${lccn}` : '');
      return {
        key: permalink || title,
        title,
        authors: grabAll('creator').slice(0, 4).join('، '),
        year: Number((date.match(/\d{4}/) || [])[0]) || null,
        source: 'Library of Congress',
        abstract: grabAll('description')[0] || '',
        subjects: grabAll('subject').slice(0, 6).join(' · '),
        url: permalink || `https://www.loc.gov/search/?q=${encodeURIComponent(title)}`,
        downloadable: false,
        locator: permalink
      };
    });
}

/**
 * بحث في CORE — أكبر تجميع عالمي للأبحاث مفتوحة الوصول (نصوص كاملة).
 * مجاني بمفتاح بسيط (تسجيل مجاني في core.ac.uk/kb) — بلا مفتاح يعود
 * رسالة عربية واضحة بدل صمت، ونتائجه كلها مفتوحة الوصول أصلاً.
 */
async function searchCore({ q, subject, limit, years = {} }) {
  const apiKey = String(process.env.CORE_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error(
      'مصدر CORE يحتاج مفتاحاً مجانياً — سجّل في core.ac.uk/kb ثم ضع CORE_API_KEY في إعدادات الخادم.'
    );
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const query = [q, subject].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(Math.max(Number(limit) || 20, 1), 25))
  });
  if (years.from) params.set('yearFrom', String(years.from));
  if (years.to) params.set('yearTo', String(years.to));

  const response = await fetch(`https://api.core.ac.uk/v3/search/works?${params.toString()}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    const error = new Error(`CORE ردّ بحالة ${response.status}.`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const data = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
  return (Array.isArray(data?.result) ? data.result : []).map((paper) => {
    const doi = String(paper.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const pdfUrl = String(paper.downloadUrl || '');
    const link = pdfUrl || (doi ? `https://doi.org/${doi}` : '');
    return {
      key: doi || String(paper.id || ''),
      title: stripHtml(paper.title || '(بدون عنوان)'),
      authors: []
        .concat(paper.authors || [])
        .map((author) => (typeof author === 'string' ? author : author?.name))
        .filter(Boolean)
        .slice(0, 6)
        .join('، '),
      year: Number(paper.yearPublished) || null,
      source: 'CORE',
      abstract: stripHtml(paper.abstract || '').slice(0, 5000),
      subjects: '',
      url: link || `https://core.ac.uk/search/?q=${encodeURIComponent(query)}`,
      pdfUrl,
      doi,
      venue: '',
      publisher: '',
      type: 'article',
      volume: '',
      issue: '',
      pages: '',
      citations: Number(paper.citationCount || 0),
      isOpenAccess: true,
      downloadable: Boolean(pdfUrl),
      locator: pdfUrl || doi
    };
  });
}

/**
 * بحث في PubMed Central (NCBI) — أرشيف الطب مفتوح النصوص الكامل عبر
 * E-utilities الرسمية بلا مفتاح: ESearch يعطي المعرّفات ثم ESummary بياناتها.
 * نرسل tool/email لبقائية الخدمة كما توصي NCBI، وفلتر السنة يمرّ خادمياً
 * عبر mindate/maxdate (datetype=pdat).
 */
async function searchPmc({ q, subject, limit, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const size = Math.min(Math.max(Number(limit) || 20, 1), 20);
  const tool = 'zena-ai-library';

  const searchParams = new URLSearchParams({
    db: 'pmc',
    term: query,
    retmode: 'json',
    retmax: String(size),
    // ترتيب NCBI الافتراضي «الأحدث» يعيد عناوين غير مطابقة للموضوع — نرتّب بالملاءمة
    sort: 'relevance',
    tool
  });
  if (UNPAYWALL_EMAIL) searchParams.set('email', UNPAYWALL_EMAIL);
  if (years.from) searchParams.set('mindate', String(years.from));
  if (years.to) searchParams.set('maxdate', String(years.to));
  if (years.from || years.to) searchParams.set('datetype', 'pdat');

  const search = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`
  );
  const ids = (Array.isArray(search?.esearchresult?.idlist) ? search.esearchresult.idlist : []).slice(0, size);
  if (!ids.length) return [];

  const summary = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${new URLSearchParams({
      db: 'pmc',
      id: ids.join(','),
      retmode: 'json',
      tool
    })}`
  );
  const result = summary?.result || {};
  return (Array.isArray(result.uids) ? result.uids : [])
    .map((uid) => result[uid])
    .filter(Boolean)
    .map((paper) => {
      const articleIds = Array.isArray(paper.articleids) ? paper.articleids : [];
      const doi = String(articleIds.find((entry) => entry.idtype === 'doi')?.value || '');
      const pmcid = String(articleIds.find((entry) => entry.idtype === 'pmcid')?.value || `PMC${paper.uid || ''}`);
      const rawDate = String(paper.pubdate || paper.epubdate || '');
      return {
        key: doi || pmcid,
        title: stripHtml(paper.title || '(بدون عنوان)'),
        authors: (Array.isArray(paper.authors) ? paper.authors : [])
          .map((author) => author?.name)
          .filter(Boolean)
          .slice(0, 6)
          .join('، '),
        year: Number((rawDate.match(/\d{4}/) || [])[0]) || null,
        source: String(paper.fulljournalname || paper.source || 'PubMed Central'),
        abstract: '',
        subjects: '',
        url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
        doi,
        venue: String(paper.source || ''),
        publisher: '',
        type: 'article',
        volume: String(paper.volume || ''),
        issue: String(paper.issue || ''),
        pages: String(paper.pages || ''),
        citations: 0,
        isOpenAccess: true,
        downloadable: Boolean(doi),
        locator: doi || pmcid
      };
    });
}

/**
 * بحث في HAL — الأرشيف العلمي المفتوح الفرنسي (بلا مفتاح): مقالات ومسودات
 * من مئات المؤسسات الأوروبية مع رابط PDF مباشر (fileMain_s) وملخصات.
 */
async function searchHal({ q, subject, limit, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams({
    q: query,
    fl: [
      'title_s',
      'authFullName_s',
      'producedDateY_i',
      'doiId_s',
      'uri_s',
      'fileMain_s',
      'abstract_s',
      'keyword_s',
      'journalTitle_s'
    ].join(','),
    rows: String(Math.min(Math.max(Number(limit) || 20, 1), 25)),
    wt: 'json'
  });
  if (years.from || years.to) {
    params.set('fq', `producedDateY_i:[${years.from || '*'} TO ${years.to || '*'}]`);
  }

  const data = await fetchJson(`https://api.archives-ouvertes.fr/search/?${params.toString()}`);
  return (Array.isArray(data?.response?.docs) ? data.response.docs : []).map((doc) => {
    const doi = String(doc.doiId_s || '');
    const pdfUrl = String(doc.fileMain_s || '');
    const uri = String(doc.uri_s || '');
    return {
      key: doi || uri,
      title: stripHtml([].concat(doc.title_s || [])[0] || '(بدون عنوان)'),
      authors: [].concat(doc.authFullName_s || []).filter(Boolean).slice(0, 6).join('، '),
      year: Number(doc.producedDateY_i) || null,
      source: 'HAL — Open Archive',
      abstract: stripHtml([].concat(doc.abstract_s || [])[0] || '').slice(0, 5000),
      subjects: [].concat(doc.keyword_s || []).filter(Boolean).slice(0, 6).join(' · '),
      url: uri || (doi ? `https://doi.org/${doi}` : ''),
      pdfUrl,
      doi,
      venue: String(doc.journalTitle_s || ''),
      publisher: '',
      type: 'article',
      volume: '',
      issue: '',
      pages: '',
      citations: 0,
      isOpenAccess: Boolean(pdfUrl),
      downloadable: Boolean(pdfUrl),
      locator: pdfUrl || doi || uri
    };
  });
}

/**
 * بحث في BASE (Bielefeld) — محرك بحث أكاديمي ألماني ضخم يجمع مستودعات العالم.
 * مجاني لكنه يطلب تسجيلاً مجانياً يشمل عنوان IP ووكيل المستخدم (BASE_API_USER
 * وBASE_API_PASS على base-search.net) — بلا بيانات اعتماد يعود رسالة عربية
 * واضحة. بنية حقول النتائج dc-prefixed (dctitle · dccreator · dcyear · dclink ·
 * dcoa) حسب واجهة API المعلنة؛ dcoa=1 تعني نسخة مفتوحة.
 */
async function searchBase({ q, subject, limit }) {
  const user = String(process.env.BASE_API_USER || '').trim();
  const pass = String(process.env.BASE_API_PASS || '').trim();
  if (!user || !pass) {
    const error = new Error(
      'مصدر BASE يحتاج تسجيلاً مجانياً — سجّل في base-search.net (يتضمن تسجيل IP الخادم) ثم ضع BASE_API_USER وBASE_API_PASS.'
    );
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const query = [q, subject].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams({
    func: 'PerformSearch',
    query,
    format: 'json',
    hits: String(Math.min(Math.max(Number(limit) || 20, 1), 25))
  });

  const response = await fetch(`https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?${params.toString()}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
    }
  });
  if (!response.ok) {
    const error = new Error(`BASE ردّ بحالة ${response.status}.`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const data = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
  if (data?.error) {
    const error = new Error(`BASE: ${String(data.error)}`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  return (Array.isArray(data?.response?.docs) ? data.response.docs : []).map((doc) => {
    const identifiers = [].concat(doc.dcidentifier || []).filter(Boolean);
    const doi = identifiers.map((value) => extractDoi(value)).find(Boolean) || '';
    const link = String(doc.dclink || '');
    const isOpenAccess = String(doc.dcoa || '') === '1';
    const rawYear = [].concat(doc.dcyear || [])[0] || '';
    return {
      key: doi || link,
      title: stripHtml([].concat(doc.dctitle || [])[0] || '(بدون عنوان)'),
      authors: [].concat(doc.dccreator || []).filter(Boolean).slice(0, 6).join('، '),
      year: Number(String(rawYear).match(/\d{4}/)?.[0]) || null,
      source: 'BASE',
      abstract: stripHtml([].concat(doc.dcdescription || [])[0] || '').slice(0, 5000),
      subjects: '',
      url: link || (doi ? `https://doi.org/${doi}` : ''),
      pdfUrl: isOpenAccess ? link : '',
      doi,
      venue: '',
      publisher: stripHtml([].concat(doc.dcpublisher || [])[0] || ''),
      type: 'article',
      volume: '',
      issue: '',
      pages: '',
      citations: 0,
      isOpenAccess,
      downloadable: Boolean(isOpenAccess && link),
      locator: (isOpenAccess && link) || doi || link
    };
  });
}

/**
 * جلب JSON مع إعادة محاولة واحدة عند 429/503 (المصادر المفتوحة تحدّ المعدل)
 * + مهلة أطول في المحاولة الثانية.
 */
async function fetchJsonRetry(url, { attempts = 2, waitMs = 1200 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, waitMs * attempt));
    try {
      return await fetchJson(url, { timeoutMs: SEARCH_TIMEOUT_MS * attempt });
    } catch (error) {
      const status = Number(String(error?.message || '').match(/(\d{3})/)?.[1] || 0);
      const retryable = status === 429 || status === 503 || status >= 500 || error?.name === 'TimeoutError';
      if (attempt >= attempts || !retryable) throw error;
    }
  }
  return null;
}

/** عناوين لا تصلح كمرجع (أجزاء كتابية أو ملفات فيديو مرافقة) تُستبعد من النتائج. */
function isJunkTitle(title) {
  return /^(front matter|back matter|index|table of contents|corrigendum|erratum|correction|editorial|video for|supplementary|list of (contributors|reviewers))/i.test(
    String(title || '').trim()
  );
}

/** DOI لملف مرافق (فيديو/ملحق) لا يُعدّ مقالاً مستقلاً. */
function isSupplementaryDoi(doi) {
  return /\/(video|suppl|supplementary|figures?|tables?|appendi)/i.test(String(doi || ''));
}

/**
 * بحث في Crossref — قاعدة بيانات الاستشهادات الرسمية لأي ناشر.
 * نفس المحرك يخدم «IEEE Xplore» و«ACM DL» عبر فلتر بادئة DOI، فيعود الرابط
 * الرسمي للناشر مع كل بيانات الاستشهاد (مجلة · دار نشر · مجلد · عدد · صفحات).
 */
async function searchCrossref({ q, subject, limit, prefix = '', years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams({
    'query.bibliographic': query,
    rows: String(Math.min(Number(limit || 20) * 2, 50)), // نؤخذ الضعف ثم نرتّب
    // البريد يوفّرنا في «النسخة المهذّبة» (polite pool) ⇒ حدود أوسع من Crossref
    mailto: UNPAYWALL_EMAIL,
    select:
      'DOI,title,author,issued,container-title,publisher,volume,issue,page,type,URL,subject,is-referenced-by-count,link,abstract,score'
  });
  // أزواج فلتر key:val — بادئة واحدة أو عدّة بادئات (تُكرَّر المفتاح كما يقبل Crossref)
  // مضافاً إليها فترة الإصدار (from-pub-date / until-pub-date).
  const filters = [];
  for (const value of (Array.isArray(prefix) ? prefix : [prefix]).filter(Boolean)) {
    filters.push(`prefix:${value}`);
  }
  if (years.from) filters.push(`from-pub-date:${years.from}-01-01`);
  if (years.to) filters.push(`until-pub-date:${years.to}-12-31`);
  if (filters.length) params.set('filter', filters.join(','));

  const data = await fetchJsonRetry(`https://api.crossref.org/works?${params.toString()}`);
  const items = (Array.isArray(data?.message?.items) ? data.message.items : [])
    .filter((item) => !isJunkTitle(item.title?.[0]) && !isSupplementaryDoi(item.DOI))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.max(Number(limit) || 20, 1));

  return items.map((item) => {
    const doi = String(item.DOI || '');
    const pdfLink = (Array.isArray(item.link) ? item.link : []).find(
      (link) => String(link['content-type'] || '').includes('pdf') && link.URL
    );

    return {
      key: doi || item.URL || item.title?.[0] || '',
      title: stripHtml(item.title?.[0] || '(بدون عنوان)'),
      authors: (Array.isArray(item.author) ? item.author : [])
        .map((author) => [author.given, author.family].filter(Boolean).join(' '))
        .filter(Boolean)
        .slice(0, 6)
        .join('، '),
      year: Number(item.issued?.['date-parts']?.[0]?.[0]) || null,
      source: String(item['container-title']?.[0] || item.publisher || 'Crossref'),
      abstract: stripHtml(item.abstract || ''),
      subjects: (Array.isArray(item.subject) ? item.subject : []).slice(0, 6).join(' · '),
      url: publisherLandingUrl(doi) || String(item.URL || ''),
      pdfUrl: pdfLink ? String(pdfLink.URL) : '',
      doi,
      venue: String(item['container-title']?.[0] || ''),
      publisher: String(item.publisher || ''),
      type: String(item.type || '').replace(/-/g, ' '),
      volume: String(item.volume || ''),
      issue: String(item.issue || ''),
      pages: String(item.page || ''),
      citations: Number(item['is-referenced-by-count'] || 0),
      isOpenAccess: Boolean(pdfLink),
      downloadable: Boolean(pdfLink),
      // locator: رابط PDF إن وُجد وإلا DOI (يحوّله Unpaywall إلى نسخة مفتوحة)
      locator: pdfLink ? String(pdfLink.URL) : doi
    };
  });
}

/** يعيد النص من الملخص المقلوب في OpenAlex (كلمة/موضع) إلى نص مقروء. */
function openAlexAbstract(inverted) {
  if (!inverted || typeof inverted !== 'object') return '';
  const pairs = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const position of Array.isArray(positions) ? positions : [positions]) pairs.push([position, word]);
  }
  return stripHtml(pairs.sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(' '));
}

/** بحث في OpenAlex — فهرس مفتوح يغطي IEEE وACM وSpringer وElsevier + رابط PDF مفتوح. */
async function searchOpenAlex({ q, subject, limit, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  // فترة الإصدار تُرشَّح عند المصدر نفسه حتى لا تملأ النتائج خارج الفترة المطلوبة
  const range = [];
  if (years.from) range.push(`from_publication_date:${years.from}-01-01`);
  if (years.to) range.push(`to_publication_date:${years.to}-12-31`);
  const data = await fetchJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=id,doi,title,authorships,publication_year,primary_location,best_oa_location,open_access,cited_by_count,abstract_inverted_index,type${
      range.length ? `&filter=${range.join(',')}` : ''
    }`
  );

  return (Array.isArray(data.results) ? data.results : []).map((work) => {
    const doi = String(work.doi || '').replace(/^https?:\/\/doi\.org\//i, '');
    const venue = String(work.primary_location?.source?.display_name || '');
    const pdfUrl = String(work.best_oa_location?.pdf_url || work.open_access?.oa_url || '');

    return {
      key: doi || work.id || '',
      title: stripHtml(work.title || '(بدون عنوان)'),
      authors: (Array.isArray(work.authorships) ? work.authorships : [])
        .map((entry) => entry?.author?.display_name)
        .filter(Boolean)
        .slice(0, 6)
        .join('، '),
      year: Number(work.publication_year) || null,
      source: venue || 'OpenAlex',
      abstract: openAlexAbstract(work.abstract_inverted_index),
      subjects: '',
      url: doi ? `https://doi.org/${doi}` : String(work.id || ''),
      pdfUrl,
      doi,
      venue,
      publisher: '',
      type: String(work.type || ''),
      volume: '',
      issue: '',
      pages: '',
      citations: Number(work.cited_by_count || 0),
      isOpenAccess: Boolean(work.open_access?.is_oa),
      downloadable: Boolean(pdfUrl),
      locator: pdfUrl || doi
    };
  });
}

/** مهلة قصوى لنداء Semantic Scholar (الخدمة بطيئة/محدودة بلا مفتاح). */
const SEMANTIC_TIMEOUT_MS = 9000;

/** بحث في Semantic Scholar — دلالي مع معرّفات DOI/arXiv ورابط PDF مفتوح. */
async function searchSemanticScholar({ q, subject, limit, retry = true, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  const fields = 'title,abstract,year,venue,publicationVenue,authors,externalIds,openAccessPdf,citationCount,fieldsOfStudy,publicationTypes,url';
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
  const apiKey = String(process.env.SEMANTIC_SCHOLAR_API_KEY || '').trim();
  if (apiKey) headers['x-api-key'] = apiKey;

  // فترة الإصدار: Semantic Scholar يقبل سنة أو مدى (YYYY-YYYY) — نُغلق المدى دائماً
  const yearRange = years.from || years.to ? `&year=${years.from || 1500}-${years.to || 2100}` : '';
  const response = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}${yearRange}`,
    { redirect: 'follow', signal: AbortSignal.timeout(SEMANTIC_TIMEOUT_MS), headers }
  );
  // Semantic Scholar يحدّ المعدل بشدّة بلا مفتاح ⇒ ننتظر ونعيد مرة واحدة فقط.
  if (response.status === 429 && retry) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return searchSemanticScholar({ q, subject, limit: Math.max(1, Math.floor(limit / 2)), retry: false, years });
  }
  if (!response.ok) {
    const error = new Error(`Semantic Scholar ردّ بحالة ${response.status}.`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const data = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
  return (Array.isArray(data.data) ? data.data : []).map((paper) => {
    const doi = String(paper.externalIds?.DOI || '');
    const pdfUrl = String(paper.openAccessPdf?.url || '');

    return {
      key: doi || paper.paperId || '',
      title: stripHtml(paper.title || '(بدون عنوان)'),
      authors: (Array.isArray(paper.authors) ? paper.authors : [])
        .map((author) => author?.name)
        .filter(Boolean)
        .slice(0, 6)
        .join('، '),
      year: Number(paper.year) || null,
      source: String(paper.publicationVenue?.name || paper.venue || 'Semantic Scholar'),
      abstract: stripHtml(paper.abstract || ''),
      subjects: (Array.isArray(paper.fieldsOfStudy) ? paper.fieldsOfStudy : []).slice(0, 6).join(' · '),
      url: doi ? `https://doi.org/${doi}` : String(paper.url || ''),
      pdfUrl,
      doi,
      venue: String(paper.publicationVenue?.name || paper.venue || ''),
      publisher: '',
      type: (Array.isArray(paper.publicationTypes) ? paper.publicationTypes : []).join(' · '),
      volume: '',
      issue: '',
      pages: '',
      citations: Number(paper.citationCount || 0),
      isOpenAccess: Boolean(pdfUrl),
      downloadable: Boolean(pdfUrl),
      locator: pdfUrl || doi
    };
  });
}

/** يستخرج قيم وسوم XML بسيطة (بلا مكتبة XML). */
function xmlTags(xml, tag) {
  const out = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let match = pattern.exec(xml);
  while (match) {
    out.push(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
    match = pattern.exec(xml);
  }
  return out;
}

/** بحث في arXiv — مسودات مفتوحة برابط PDF مباشر (علوم حاسوب · ذكاء اصطناعي · فيزياء). */
async function searchArxiv({ q, subject, limit, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' AND ').trim();
  // فترة الإصدار عبر submittedDate تُدمج مع عبارة البحث بـAND (صيغة arXiv المعتمدة)
  const yearSpan =
    years.from || years.to
      ? ` AND submittedDate:[${years.from || 1500}01010000 TO ${years.to || 2100}12312359]`
      : '';
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(
    `all:${query}${yearSpan}`
  )}&start=0&max_results=${limit}`;
  assertPublicUrl(url);

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/atom+xml' }
  });
  if (!response.ok) {
    const error = new Error(`arXiv ردّ بحالة ${response.status}.`);
    error.code = 'SOURCE_HTTP';
    throw error;
  }

  const xml = Buffer.from(await response.arrayBuffer()).toString('utf8');

  return xml
    .split('<entry>')
    .slice(1)
    .map((entry) => {
      const absId = /<id>([^<]+)<\/id>/.exec(entry)?.[1] || '';
      const doi = extractDoi(entry);
      const pdfUrl = (/<link[^>]+title="pdf"[^>]+href="([^"]+)"/.exec(entry)?.[1] || '').replace(/^http:/, 'https:');

      return {
        key: absId,
        title: stripHtml(xmlTags(entry, 'title')[0] || '(بدون عنوان)'),
        authors: xmlTags(entry, 'name').slice(0, 6).join('، '),
        year: Number((xmlTags(entry, 'published')[0] || '').slice(0, 4)) || null,
        source: 'arXiv (preprint)',
        abstract: stripHtml(xmlTags(entry, 'summary')[0] || ''),
        subjects: xmlTags(entry, 'category')
          .flatMap((term) => term.split(/\s+/))
          .slice(0, 6)
          .join(' · '),
        url: absId,
        pdfUrl,
        doi,
        venue: stripHtml(xmlTags(entry, 'arxiv:journal_ref')[0] || ''),
        publisher: 'arXiv',
        type: 'preprint',
        volume: '',
        issue: '',
        pages: '',
        citations: 0,
        isOpenAccess: true,
        downloadable: Boolean(pdfUrl),
        locator: pdfUrl || absId
      };
    });
}

/** بحث في Europe PMC — طب وعلوم حيوية مع رابط النص الكامل المفتوح. */
async function searchEuropePmc({ q, subject, limit, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  // فترة الإصدار: صيغة Europe PMC المعتمدة FIRST_PDATE:[من-01-01 TO إلى-12-31]
  const range =
    years.from || years.to
      ? ` AND (FIRST_PDATE:[${years.from || 1500}-01-01 TO ${years.to || 2100}-12-31])`
      : '';
  const data = await fetchJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(
      query + range
    )}&format=json&pageSize=${limit}&resultType=core`
  );

  return (Array.isArray(data.resultList?.result) ? data.resultList.result : []).map((row) => {
    const doi = String(row.doi || '');
    const pdfUrl =
      (Array.isArray(row.fullTextUrlList?.fulltextUrl) ? row.fullTextUrlList.fulltextUrl : []).find(
        (entry) => String(entry.documentStyle || '').toLowerCase() === 'pdf' && entry.url
      )?.url || '';

    return {
      key: doi || row.pmid || row.id || '',
      title: stripHtml(row.title || '(بدون عنوان)'),
      authors: stripHtml(row.authorString || '').slice(0, 300),
      year: Number(row.pubYear) || null,
      source: String(row.journalTitle || 'Europe PMC'),
      abstract: stripHtml(row.abstractText || ''),
      subjects: '',
      url: doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${row.source || 'MED'}/${row.id || ''}`,
      pdfUrl,
      doi,
      venue: String(row.journalTitle || ''),
      publisher: '',
      type: String(row.pubType || ''),
      volume: String(row.journalVolume || ''),
      issue: String(row.issue || ''),
      pages: String(row.pageInfo || ''),
      citations: Number(row.citedByCount || 0),
      isOpenAccess: row.isOpenAccess === 'Y',
      downloadable: Boolean(pdfUrl),
      locator: pdfUrl || doi || String(row.pmid || '')
    };
  });
}

/**
 * رابط PDF قانوني (نسخة مفتوحة) لأي DOI عبر Unpaywall — يعمل مع IEEE وACM
 * وSpringer وغيرها. الخدمة مجانية وتطلب بريد تواصل فقط.
 */
export async function openAccessPdfUrl(doi) {
  const value = String(doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!isDoi(value)) return '';

  try {
    const data = await fetchJson(
      `https://api.unpaywall.org/v2/${encodeURIComponent(value)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`
    );
    const direct = data.best_oa_location?.url_for_pdf || '';
    if (direct) return direct;
    const fallback = (Array.isArray(data.oa_locations) ? data.oa_locations : []).find((loc) => loc?.url_for_pdf);
    return String(fallback?.url_for_pdf || '');
  } catch (error) {
    console.warn(`تعذّر جلب نسخة مفتوحة عبر Unpaywall: ${error?.code || error?.message}`);
    return '';
  }
}

/**
 * يوحّد فلتر سنة الإصدار القادم من الاستعلام أو الواجهة:
 *   - أرقام صحيحة بين 1500 و2100 فقط (وما عداها يُلغى = 0 = بلا ترشيح).
 *   - الطرفان قابلان للاستقلال: من-بدون-إلى أو إلى-بدون-من.
 *   - إن كان «من» أكبر من «إلى» يُقلَبان بدل رفض البحث.
 * مصدر واحد للحقيقة يستخدمه كل مصادر البحث ومسار /library معاً.
 */
export function normalizeYearRange(yearFrom, yearTo) {
  const pick = (value) => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isInteger(parsed) && parsed >= 1500 && parsed <= 2100 ? parsed : 0;
  };
  let from = pick(yearFrom);
  let to = pick(yearTo);
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

/**
 * بحث «Unpaywall»: نتائج واسعة من Crossref ثم نتحقّق من أقرب نسخة PDF مفتوحة
 * قانونياً لكل DOI عبر Unpaywall (مجاني ببريد التواصل) — يعطي الباحث رابط النص
 * الكامل المباشر حين يملكه الناشر أو المستودع المؤسسي. حدّ لبقائية الخدمة:
 * أول 6 DOIs بلا رابط فقط في كل بحث.
 */
async function searchUnpaywall({ q, subject, limit, years = {} }) {
  const items = await searchCrossref({ q, subject, limit, years });
  const missing = items.filter((item) => item.doi && !item.pdfUrl).slice(0, 6);
  await Promise.allSettled(
    missing.map(async (item) => {
      const pdf = await openAccessPdfUrl(item.doi);
      if (!pdf) return;
      item.pdfUrl = pdf;
      item.isOpenAccess = true;
      item.downloadable = true;
      item.locator = pdf;
    })
  );
  return items;
}

/**
 * Toubkal — المستودع الرقمي للجامعات المغربية (DSpace 7 REST API) بلا مفتاح:
 * أطروحات ومقالات جامعة محمد الخامس (UM5) وجامعة محمد الأول (Oujda).
 * الفلترة بسنة الإصدار تتم عند المصدر عبر صيغة Discover
 * (dc.date.issued:[من TO إلى]) والتحميل لاحقاً عبر downloadFromToubkal.
 */
const TOUBKAL_BASE = 'https://toubkal.imist.ma';

async function searchToubkal({ q, subject, limit, years = {} }) {
  const query = [q, subject].filter(Boolean).join(' ').trim();
  // نطاق السنة يُضاف للـquery بصيغة Discover الموثّقة حيّاً (اختُبرت: 2020-2025 → كل النتائج داخل المدى)
  const ranged =
    years.from || years.to
      ? `(${query}) AND dc.date.issued:[${years.from || '*'} TO ${years.to || '*'}]`
      : query;
  const url = `${TOUBKAL_BASE}/server/api/discover/search/objects?query=${encodeURIComponent(
    ranged
  )}&size=${Math.min(Math.max(Number(limit) || 10, 1), 25)}`;
  assertPublicUrl(url);

  const data = await fetchJson(url);
  const objects = data?._embedded?.searchResult?._embedded?.objects || [];

  return objects
    .map((entry) => {
      const item = entry?._embedded?.indexableObject;
      if (!item?.uuid) return null;
      const meta = item.metadata || {};
      const value = (key) => String(meta[key]?.[0]?.value || '').trim();
      const yearRaw = value('dc.date.issued');
      const authors = (Array.isArray(meta['dc.contributor.author']) ? meta['dc.contributor.author'] : [])
        .map((node) => String(node?.value || '').trim())
        .filter(Boolean);
      const subjects = (Array.isArray(meta['dc.subject']) ? meta['dc.subject'] : [])
        .map((node) => String(node?.value || '').trim())
        .filter(Boolean);
      const publisher = value('dc.publisher');

      return {
        key: String(item.uuid),
        title: stripHtml(value('name') || item.name || '(بدون عنوان)'),
        authors: authors.slice(0, 5).join('، '),
        year: Number(yearRaw.slice(0, 4)) || null,
        source: publisher ? `${publisher} — Toubkal` : 'Toubkal — المستودع المغربي',
        abstract: stripHtml(value('dc.description.abstract')).slice(0, 600),
        subjects: subjects.slice(0, 6).join(' · '),
        url: item.handle ? `${TOUBKAL_BASE}/handle/${item.handle}` : `${TOUBKAL_BASE}/items/${item.uuid}`,
        downloadable: Boolean(item.uuid),
        locator: `toubkal:${item.uuid}`
      };
    })
    .filter(Boolean);
}

/** جدول البحثات حسب معرّف المصدر — بعد تعريف كل دالة. */
const SEARCHERS = {
  crossref: (args) => searchCrossref(args),
  openalex: (args) => searchOpenAlex(args),
  // IEEE Xplore و ACM Digital Library عبر بادئة DOI الرسمية لهما في Crossref
  ieee: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIXES.ieee }),
  acm: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIXES.acm }),
  // ناشرون عالميون (مجانيون البحث) عبر مجموعات بادئاتهم في Crossref
  springer: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIX_SETS.springer }),
  wiley: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIX_SETS.wiley }),
  tandf: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIX_SETS.tandf }),
  sage: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIX_SETS.sage }),
  // Unpaywall: بحث Crossref مع تحقّق PDF مفتوح لكل DOI
  unpaywall: (args) => searchUnpaywall(args),
  semantic: (args) => searchSemanticScholar(args),
  arxiv: (args) => searchArxiv(args),
  europepmc: (args) => searchEuropePmc(args),
  openlibrary: (args) => searchOpenLibrary(args),
  doaj: (args) => searchDoaj(args),
  zenodo: (args) => searchZenodo(args),
  // كتب وأرشيفات: Internet Archive · مكتبة الكونجرس (SRU) · CORE (نصوص مفتوحة)
  internetarchive: (args) => searchInternetArchive(args),
  loc: (args) => searchLibraryOfCongress(args),
  core: (args) => searchCore(args),
  // طب (NCBI) · أرشيف مفتوح أوروبي (HAL) · مستودعات العالم (BASE) · SSRN عبر بادئة DOI
  pmc: (args) => searchPmc(args),
  hal: (args) => searchHal(args),
  base: (args) => searchBase(args),
  // مستودع الجامعات المغربية Toubkal (DSpace 7 REST — أطروحات ومقالات UM5)
  toubkal: (args) => searchToubkal(args),
  ssrn: (args) => searchCrossref({ ...args, prefix: PUBLISHER_PREFIX_SETS.ssrn })
};

/** المصادر التي بحثها Crossref بـ DOI (تعطي بيانات استشهاد كاملة + رابط ناشر). */
const CROSSREF_BASED = new Set(['crossref', 'ieee', 'acm', 'springer', 'wiley', 'tandf', 'sage', 'unpaywall']);

/**
 * يحوّل DOI (أو أي رابط يحتوي DOI) إلى سجل مرجعي كامل — أداة الباحث حين يعرف
 * العنوان أو رابطه فقط: البيانات + رابط الناشر + نسخة PDF مفتوحة إن وُجدت.
 */
export async function resolveDoiRecord(input) {
  const raw = String(input || '').trim();
  const doi = extractDoi(raw) || (isDoi(raw) ? raw.replace(/^doi:\s*/i, '') : '');
  if (!doi) return null;

  let record = null;

  // 1) طلب DOI مباشرة من Crossref (أدق من البحث النصي).
  try {
    const data = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    const item = data?.message;
    if (item) {
      const pdfLink = (Array.isArray(item.link) ? item.link : []).find(
        (link) => String(link['content-type'] || '').includes('pdf') && link.URL
      );
      record = {
        key: doi,
        title: stripHtml(item.title?.[0] || '(بدون عنوان)'),
        authors: (Array.isArray(item.author) ? item.author : [])
          .map((author) => [author.given, author.family].filter(Boolean).join(' '))
          .filter(Boolean)
          .slice(0, 6)
          .join('، '),
        year: Number(item.issued?.['date-parts']?.[0]?.[0]) || null,
        source: String(item['container-title']?.[0] || item.publisher || 'Crossref'),
        abstract: stripHtml(item.abstract || ''),
        subjects: (Array.isArray(item.subject) ? item.subject : []).slice(0, 6).join(' · '),
        url: publisherLandingUrl(doi),
        pdfUrl: pdfLink ? String(pdfLink.URL) : '',
        doi,
        venue: String(item['container-title']?.[0] || ''),
        publisher: String(item.publisher || ''),
        type: String(item.type || '').replace(/-/g, ' '),
        volume: String(item.volume || ''),
        issue: String(item.issue || ''),
        pages: String(item.page || ''),
        citations: Number(item['is-referenced-by-count'] || 0),
        isOpenAccess: Boolean(pdfLink),
        downloadable: Boolean(pdfLink),
        locator: pdfLink ? String(pdfLink.URL) : doi
      };
    }
  } catch (error) {
    console.warn(`تعذّر حلّ DOI ${doi}: ${error?.code || error?.message}`);
  }

  // 2) لا PDF مباشر؟ نبحث عن نسخة مفتوحة قانونية عبر Unpaywall.
  if (record && !record.pdfUrl) {
    const oa = await openAccessPdfUrl(doi);
    if (oa) {
      record.pdfUrl = oa;
      record.isOpenAccess = true;
      record.downloadable = true;
      record.locator = oa;
    }
  }

  return record;
}

/**
 * قراءة بيانات المرجع من **الرابط نفسه** (روابط الناشرين/المجلات التي في المكتبة).
 * مواقع المجلات والناشرين تضع وسوم `citation_*` القياسية (نفس المعيار الذي تستخدمه Google
 * Scholar وHighwire): العنوان · المؤلفون · المجلة · التاريخ · المجلد · العدد · الصفحات · DOI · رابط PDF.
 * نقرأها ونحوّلها إلى سجل مرجعي كامل — تماماً كما طلبت: «يجيب النتائج من الروابط التي هناك».
 */
export async function fetchCitationMetadata(url, { timeoutMs = 12000 } = {}) {
  const parsed = assertPublicUrl(url);

  const response = await fetch(parsed.toString(), {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) return null;

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 3 * 1024 * 1024) return null;

  const html = Buffer.from(await response.arrayBuffer()).toString('utf8');

  /** كل قيم وسم معيّن (متعدد مثل author). */
  const metaAll = (name) => {
    const out = [];
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`,
      'gi'
    );
    let match = pattern.exec(html);
    while (match) {
      const content = /content=["']([^"']*)["']/i.exec(match[0])?.[1];
      if (content) out.push(decodeEntities(content.trim()));
      match = pattern.exec(html);
    }
    // بعض الصفحات تضع content قبل name ⇒ نمط ثانٍ
    if (!out.length) {
      const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'gi');
      let m2 = alt.exec(html);
      while (m2) {
        out.push(decodeEntities(m2[1].trim()));
        m2 = alt.exec(html);
      }
    }
    return out.filter(Boolean);
  };

  const title = metaAll('citation_title')[0] || metaAll('og:title')[0] || metaAll('dc.title')[0] || '';
  const authors = metaAll('citation_author').length ? metaAll('citation_author') : metaAll('dc.creator');
  const venue =
    metaAll('citation_journal_title')[0] || metaAll('citation_conference_title')[0] || metaAll('og:site_name')[0] || '';
  const date = metaAll('citation_publication_date')[0] || metaAll('citation_date')[0] || '';
  const doi = (metaAll('citation_doi')[0] || (html.match(/10\.\d{4,9}\/[^\s"'<>]+/)?.[0] ?? '')).replace(/[.,;)]+$/, '');
  const pdfUrl = metaAll('citation_pdf_url')[0] || '';
  const firstPage = metaAll('citation_firstpage')[0] || '';
  const lastPage = metaAll('citation_lastpage')[0] || '';

  if (!title && !doi) return null;

  return {
    title: stripHtml(title),
    authors: authors.map(stripHtml).slice(0, 6),
    authorText: authors.map(stripHtml).slice(0, 6).join('، '),
    year: Number((date.match(/\d{4}/)?.[0] ?? 0)) || null,
    venue: stripHtml(venue),
    publisher: stripHtml(metaAll('citation_publisher')[0] || ''),
    volume: metaAll('citation_volume')[0] || '',
    issue: metaAll('citation_issue')[0] || '',
    pages: firstPage ? `${firstPage}${lastPage ? `-${lastPage}` : ''}` : metaAll('citation_pages')[0] || '',
    doi,
    pdfUrl,
    url: parsed.toString(),
    abstract: stripHtml(metaAll('description')[0] || metaAll('og:description')[0] || '').slice(0, 600)
  };
}

/** فكّ كيانات HTML الشائعة في بيانات الوسوم. */
function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32));
}

/**
 * بحث في مصدر خارجي واحد — يعيد نتائج موحّدة أو خطأ عربياً (لا يرمي أبداً).
 * الشكل الموحّد: { key, title, authors, year, source, abstract, subjects, url, downloadable, locator }
 * ومعه حقول الاستشهاد: doi, venue, publisher, volume, issue, pages, citations, pdfUrl.
 */
export async function searchExternalLibrary({ source, q = '', subject = '', limit = 20, yearFrom = 0, yearTo = 0 } = {}) {
  const id = String(source || '');
  const query = String(q || '').trim().slice(0, 120);
  const subj = String(subject || '').trim().slice(0, 80);
  const size = Math.min(Math.max(Number(limit) || 20, 1), 25);
  // فلتر سنة الإصدار: يُوحَّد هنا ثم يمرّ للمصدر — من يدعمه يرشّح عند المصدر،
  // ومن لا يدعمه (OpenLibrary · DOAJ · Zenodo) يبقى للفلتر النهائي في searchLiterature.
  const years = normalizeYearRange(yearFrom, yearTo);

  if (!LIBRARY_SOURCES.some((item) => item.id === id)) {
    return { source: id, results: [], error: 'مصدر غير معروف.' };
  }
  if (!query && !subj) {
    return { source: id, results: [], error: 'اكتب كلمة بحث أو تصنيفاً (أو كليهما) لبدء البحث.' };
  }

  try {
    const search = SEARCHERS[id];
    const results = await search({ q: query, subject: subj, limit: size, years });
    return {
      source: id,
      q: query,
      subject: subj,
      results,
      error: results.length ? '' : 'لا نتائج — جرّب كلمات أو تصنيفاً آخر.'
    };
  } catch (error) {
    console.warn(`فشل بحث المكتبة في ${id}: ${error?.code || error?.message}`);
    return { source: id, q: query, subject: subj, results: [], error: sourceErrorMessage(error) };
  }
}

/** ترتيب تفضيل الصيغ عند الاختيار: PDF ثم EPUB ثم النص ثم الباقي المسموح. */
const EXTENSION_RANK = ['pdf', 'epub', 'txt', 'md', 'doc', 'docx', 'zip', 'ppt', 'pptx'];

function rankExtension(extension) {
  const index = EXTENSION_RANK.indexOf(extension);
  return index === -1 ? EXTENSION_RANK.length : index;
}

/** تنزيل كتاب من Internet Archive عبر مؤشر item — مع تجاوز الكتب المقيدة. */
async function downloadFromArchiveOrg(iaId) {
  const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(iaId)}`);
  if (meta.metadata?.['access-restricted-item']) {
    return { buffer: null, note: 'الكتاب مقيد الإعارة في Archive.org — أُضيفت بياناته فقط.' };
  }

  const files = (Array.isArray(meta.files) ? meta.files : []).filter(
    (file) => file?.name && !/encrypted|lending/i.test(`${file.name} ${file.format || ''}`)
  );
  const byExtension = (extension) => files.filter((file) => file.name.toLowerCase().endsWith(`.${extension}`));
  const chosen =
    byExtension('pdf').find((file) => String(file.format) === 'PDF') ||
    byExtension('pdf')[0] ||
    byExtension('epub')[0] ||
    byExtension('txt').find((file) => String(file.format) === 'DjVuTXT') ||
    byExtension('txt')[0];

  if (!chosen) {
    return { buffer: null, note: 'لا يوجد ملف قابل للتنزيل في Archive.org — أُضيفت بياناته فقط.' };
  }

  const parts = chosen.name.split('/').map(encodeURIComponent).join('/');
  const buffer = await fetchBytes(`https://archive.org/download/${encodeURIComponent(iaId)}/${parts}`);
  const fileName = chosen.name.split('/').pop();
  const extension = allowedExtensionFrom(fileName) || 'pdf';
  if (!verifyMagic(extension, buffer)) {
    return { buffer: null, note: 'الملف المنزّل ليس بصيغة صحيحة — أُضيفت البيانات فقط.' };
  }
  return { buffer, fileName, mime: mimeForExtension(extension) };
}

/** هل هذه البايتات صفحة HTML/XML بدل ملف فعلي؟ */
function looksLikeHtml(buffer) {
  const head = buffer.subarray(0, 200).toString('latin1').trimStart().toLowerCase();
  return head.startsWith('<!do') || head.startsWith('<html') || head.startsWith('<?xml');
}

/** هل المحتوى ملف PDF فعلاً؟ */
function isPdf(buffer) {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * استخراج رابط ملف PDF من صفحة هبوط المقال.
 * أغلب روابط DOAJ من نوع fulltext تشير إلى صفحة المجلة لا إلى الملف، والناشر
 * يعلن الملف الحقيقي في وسم citation_pdf_url (أو citation_pdf / eprints.document_url).
 */
async function findPdfLinkOnPage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) return '';

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 3 * 1024 * 1024) return '';

  const html = Buffer.from(await response.arrayBuffer()).toString('utf8');
  const patterns = [
    /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i,
    /<meta[^>]+name=["']citation_pdf["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:pdf["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+type=["']application\/pdf["'][^>]+href=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      try {
        // الروابط النسبية تُحَل مقابل صفحة المقال نفسها.
        return new URL(decodeURIComponent(match[1].trim()), url).toString();
      } catch {
        /* رابط غير صالح — نجرّب النمط التالي */
      }
    }
  }

  return '';
}

/**
 * تنزيل ملف مقال DOAJ:
 * - إن كان الرابط ملفاً مباشراً (PDF) نأخذه كما هو.
 * - إن كان صفحة هبوط، نبحث داخلها عن citation_pdf_url ثم ننزّل الملف الحقيقي.
 */
async function downloadDirectPdf(url) {
  const extension = allowedExtensionFrom(url) || 'pdf';
  const buffer = await fetchBytes(url);

  if (verifyMagic(extension, buffer)) {
    const urlName = decodeURIComponent(String(url).split('?')[0].split('#')[0].split('/').pop() || '');
    const fileName = allowedExtensionFrom(urlName) ? urlName : `article.${extension}`;
    return { buffer, fileName, mime: mimeForExtension(extension) };
  }

  if (extension === 'pdf' && looksLikeHtml(buffer)) {
    const pdfLink = await findPdfLinkOnPage(url);
    if (pdfLink) {
      try {
        assertPublicUrl(pdfLink);
        const pdf = await fetchBytes(pdfLink);
        if (isPdf(pdf)) {
          const name = decodeURIComponent(pdfLink.split('?')[0].split('#')[0].split('/').pop() || '');
          const fileName = allowedExtensionFrom(name) ? name : 'article.pdf';
          return { buffer: pdf, fileName, mime: mimeForExtension('pdf') };
        }
      } catch (error) {
        console.warn(`تعذّر تنزيل PDF من صفحة المقال: ${error?.code || error?.message}`);
      }
    }
    return { buffer: null, note: 'رابط المجلة لا يوفّر ملف PDF مباشر — أُضيفت البيانات فقط.' };
  }

  return { buffer: null, note: 'الرابط لا يشير إلى ملف مباشر — أُضيفت البيانات فقط.' };
}

/** تنزيل أفضل ملف لسجل Zenodo (صف السجل يحمل قائمة الملفات الحقيقية). */
async function downloadFromZenodo(recordId) {
  const record = await fetchJson(`https://zenodo.org/api/records/${encodeURIComponent(recordId)}`);
  const files = (Array.isArray(record.files) ? record.files : [])
    .map((file) => ({ file, extension: allowedExtensionFrom(file?.key) }))
    .filter((entry) => entry.extension)
    .sort((a, b) => rankExtension(a.extension) - rankExtension(b.extension));

  if (!files.length) {
    return { buffer: null, note: 'لا ملف بصيغة مدعومة في هذا السجل — أُضيفت بياناته فقط.' };
  }

  const { file, extension } = files[0];
  const buffer = await fetchBytes(file?.links?.self || '');
  if (!verifyMagic(extension, buffer)) {
    return { buffer: null, note: 'الملف المنزّل ليس بصيغة صحيحة — أُضيفت البيانات فقط.' };
  }
  const fileName = String(file.key || '').split('/').pop() || `record.${extension}`;
  return { buffer, fileName, mime: mimeForExtension(extension) };
}

/**
 * تنزيل ملف نتيجة بحث خارجي لحفظه في المكتبة — لا يرمي أبداً:
 * يعيد { buffer, fileName, mime } عند النجاح أو { buffer: null, note } عند
 * تعذّر/امتناع التنزيل (يُستورد العنصر كبيانات فقط).
 */
/**
 * تنزيل ملف أصلي من مستودع Toubkal (DSpace 7): العنصر → حزمته ORIGINAL →
 * أول ملف (عادة PDF) → رابط content. بعض السجلات وصفية بلا ملف — يعود
 * برسالة عربية واضحة بدل الفشل.
 */
async function downloadFromToubkal(uuid) {
  const safeId = encodeURIComponent(String(uuid || '').trim());
  if (!safeId) return { buffer: null, note: 'لا يوجد معرّف ملف في مستودع Toubkal — البيانات فقط.' };

  const bundlesUrl = `${TOUBKAL_BASE}/server/api/core/items/${safeId}/bundles?size=20`;
  assertPublicUrl(bundlesUrl);
  const bundles = await fetchJson(bundlesUrl);
  const list = Array.isArray(bundles?._embedded?.bundles) ? bundles._embedded.bundles : [];
  const original = list.find((bundle) => bundle?.name === 'ORIGINAL');
  const streamsHref = original?._links?.bitstreams?.href;
  if (!streamsHref) {
    return { buffer: null, note: 'هذا السجل في Toubkal ببليوغرافي فقط (بلا ملف أصلي) — البيانات والرابط الدائم.' };
  }

  assertPublicUrl(streamsHref);
  const streams = await fetchJson(streamsHref);
  const bitstreams = Array.isArray(streams?._embedded?.bitstreams) ? streams._embedded.bitstreams : [];
  const content = bitstreams[0]?._links?.content?.href;
  if (!content) {
    return { buffer: null, note: 'لا يوجد ملف مباشر في حزمة ORIGINAL — البيانات والرابط فقط.' };
  }

  assertPublicUrl(content);
  return await downloadDirectPdf(content);
}

export async function downloadExternalFile({ source, locator } = {}) {
  const id = String(source || '');
  const loc = String(locator || '').trim();
  if (!loc) return { buffer: null, note: 'لا يوجد رابط ملف لهذه النتيجة — أُضيفت البيانات فقط.' };

  try {
    if (id === 'openlibrary') {
      if (!loc.startsWith('ia:')) {
        return { buffer: null, note: 'الكتاب بلا نسخة في Archive.org — أُضيفت البيانات فقط.' };
      }
      return await downloadFromArchiveOrg(loc.slice(3));
    }
    if (id === 'doaj') {
      if (!/^https?:\/\//i.test(loc)) {
        return { buffer: null, note: 'لا رابط PDF لهذه المقالة — أُضيفت البيانات فقط.' };
      }
      return await downloadDirectPdf(loc);
    }
    if (id === 'zenodo') return await downloadFromZenodo(loc);
    if (id === 'internetarchive') {
      if (!loc.startsWith('ia:')) {
        return { buffer: null, note: 'العنصر بلا ملف مباشر — البيانات والرابط فقط.' };
      }
      return await downloadFromArchiveOrg(loc.slice(3));
    }
    if (id === 'loc') {
      return { buffer: null, note: 'سجل ببليوغرافي من مكتبة الكونجرس — البيانات والرابط الدائم فقط.' };
    }
    if (id === 'toubkal') {
      if (!loc.startsWith('toubkal:')) {
        return { buffer: null, note: 'العنصر من مستودع Toubkal — البيانات والرابط فقط.' };
      }
      return await downloadFromToubkal(loc.slice('toubkal:'.length));
    }
    if (id === 'core') {
      if (/^https?:\/\//i.test(loc)) return await downloadDirectPdf(loc);
      return { buffer: null, note: 'لا يوجد PDF مفتوح لهذه النتيجة — البيانات والرابط فقط.' };
    }

    // المصادر البحثية الحديثة: locator إمّا رابط PDF مباشر أو DOI (نبحث عن نسخة مفتوحة).
    if (CROSSREF_BASED.has(id) || ['openalex', 'semantic', 'arxiv', 'europepmc', 'pmc', 'hal', 'base'].includes(id)) {
      if (/^https?:\/\//i.test(loc)) return await downloadDirectPdf(loc);

      const oa = await openAccessPdfUrl(loc);
      if (oa) return await downloadDirectPdf(oa);

      return { buffer: null, note: 'لا توجد نسخة PDF مفتوحة لهذا العمل — أُضيفت بياناته ورابطه فقط.' };
    }

    return { buffer: null, note: 'مصدر غير معروف — أُضيفت البيانات فقط.' };
  } catch (error) {
    console.warn(`فشل تنزيل ملف المكتبة من ${id}: ${error?.code || error?.message}`);
    return { buffer: null, note: sourceErrorMessage(error) };
  }
}
