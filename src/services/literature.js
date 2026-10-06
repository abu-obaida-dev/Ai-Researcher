/**
 * أداة المراجع للباحث — الطبقة التي تربط «سؤال الباحث عن المراجع» بمصادر علمية
 * حقيقية، ثم تعطي الذكاء الاصطناعي **بيانات موثّقة** لا روابط متخيَّلة.
 *
 * لماذا هذه الأداة؟ أكثر ما يشتكي منه الباحث هو: أين يوجد المرجع؟ ومن رابطه؟
 * ومن مؤلفه؟ وفي أي مجلة وأي سنة؟ لذلك:
 *
 *   1) searchLiterature() يبحث في عدة مصادر بالتوازي مع دمج النتائج وإزالة التكرار.
 *   2) normalise() يوحّد الشكل: العنوان · المؤلفون · المجلة أو المؤتمر · الناشر ·
 *      السنة · المجلد/العدد/الصفحات · DOI · رابط الناشر · رابط PDF المفتوح ·
 *      عدد الاستشهادات.
 *   3) referenceLine() يبني سطر استشهاد جاهز (APA مبسّط) لكل نتيجة.
 *   4) literatureBlock() يحوّلها إلى كتلة تُحقن في رسالة المشرف الذكي، فلا يختلق
 *      رابطاً ولا اسم مجلة من ذاكرته، ويقول للباحث ما لم يجده بدل التخمين.
 *
 * المصادر (بلا مفاتيح إلزامية): Crossref · OpenAlex · IEEE Xplore · ACM Digital
 * Library · Semantic Scholar · arXiv · Europe PMC · DOAJ · Zenodo · Open Library،
 * مع Unpaywall للعثور على النسخة المفتوحة القانونية من أي DOI.
 */

// مبلغات المصادر: بحث خارجي بلا مفاتيح.
// ملاحظة مهمة: يُنظَّف الاستعلام أولاً، فالبحث عن «اديني اسماء مراجع» يجب أن يخصّصه
// ملف الباحث (عنوان البحث + التخصص)، وأن تُفلتر النتائج بما يطابق موضوعه فعلاً.
/**
 * ملاحظات: بحث خارجي بلا مفاتيح.
 *
 * ثلاث قواعد تحلّ مشكلة «المراجع لا تأتي حسب تخصّصي»:
 *   1) تنظيف الاستعلام: نحوّل «اديني اسماء مراجع» إلى موضوع فعلي.
 *   2) عند غموض الطلب نستخدم **ملف الباحث** (عنوان البحث + التخصص) لا لفظ «مراجع».
 *   3) ترشيح بالملاءمة: نُسقط أي نتيجة لا تتقاطع كلماتها مع الموضوع.
 */
import { fetchCitationMetadata, googleScholarUrl, resolveDoiRecord, searchExternalLibrary } from './library-sources.js';
import { registeredTopic } from './journey.js';
import { normalizeArabic, searchLibraryItems } from './workspace.js';

// نُعيد التصدير لأن بقية الخدمات (والمكتبة) تستخدم نفس التطبيع العربي.
export { normalizeArabic };

// الموضوع المسجَّل في خطته هو المصدر المعتمد للبحث (يُعاد تصديره لواجهة الأداة).
export { registeredTopic };

/** المصادر التي نبحث فيها بالتوازي افتراضياً (الأسرع والأغنى بيانات). */
export const DEFAULT_SEARCH_SOURCES = ['crossref', 'openalex', 'semantic'];

/** كل المصادر المتاحة للباحث في واجهة البحث. */
export const WEB_SOURCES = ['crossref', 'openalex', 'ieee', 'acm', 'semantic', 'arxiv', 'europepmc', 'doaj', 'openlibrary'];

/** مهلة قصوى لمصدر واحد داخل البحث المتعدد (لا نبطئ الباحث بسبب مصدر متعطّل). */
const SOURCE_BUDGET_MS = 12000;

/** مهلة قصوى للبحث المتعدد ككل — بعدها نردّ ما وصل فعلاً. */
const TOTAL_BUDGET_MS = 15000;

/** يضمن انتهاء التنفيذ خلال مهلة معيّنة مهما تعطّل المصدر (يُرجع قيمة بديلة). */
function withBudget(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/** حدّ طول استعلام البحث. */
function cleanQuery(value, max = 200) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}


/**
 * عبارات الطلب التي ليست موضوعاً — تُحذف قبل البحث.
 * بدون هذه الخطوة يذهب «اديني اسماء مراجع» إلى Crossref كما هو، فتأتي كتب
 * عن «أسماء» لا مراجع بحث (وهو ما اشتكى منه الباحثون فعلاً).
 */
const REQUEST_PHRASES =
  /(اديني|اعطني|اعطنى|اريد|أريد|ابغى|أبغى|بدي|محتاج|محتاجه|محتاجة|محتاجي|ابحث لي عن|ابحث عن|اقترح لي|اقترح|أقترح|ابحث|أبحث|استخرج|ساعدني في|ساعدني|لو سمحت|من فضلك|قائمه|قائمة|اسماء|أسماء|الاسماء|مراجع|مصدر|مصادر|اوراق|أوراق|مقالات|ابحاث|أبحاث|نتائج|اعمال|أعمال|رسائل)/g;

/**
 * كلمات قصيرة تُحذف **ككلمات مستقلة فقط** — حذفها كنصّ يقطع الكلمات:
 * «لي» من «التعليم»، «في» من «الفيزياء»، «على» من «التطبيقات».
 */
const SHORT_STOPWORDS = [
  'في', 'عن', 'مع', 'من', 'على', 'الى', 'إلى', 'كل', 'بعض', 'لي', 'لك', 'أي', 'او', 'أو', 'حول', 'هذا', 'هذه', 'ذلك', 'عند', 'حيث',
  'how', 'on', 'in', 'of', 'the', 'for', 'and', 'or', 'my', 'a', 'an', 'to', 'about', 'part', 'chapter'
];

/** حذف الكلمات القصيرة بحدود عربية صحيحة (ليست جزءاً من كلمة أطول). */
function removeShortStopwords(text) {
  let out = String(text || '');
  for (const word of SHORT_STOPWORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'giu'), ' ');
  }
  return out;
}

/** استخراج موضوع البحث من سؤال الباحث (يحذف عبارات الطلب وكلمات الربط). */
export function extractTopic(userText) {
  return removeShortStopwords(normalizeArabic(userText).replace(REQUEST_PHRASES, ' '))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * ترجمة المصطلحات الأكاديمية العربية الشائعة إلى الإنجليزية.
 * قواعد البيانات العالمية (IEEE · ACM · Crossref · OpenAlex) تفهرس العناوين
 * الإنجليزية أساساً، فالبحث العربي بلا هذا الجسر يعطي نتائج بعيدة عن الموضوع.
 */
const ARABIC_TERMS = {
  'التعلم الاله': 'machine learning',
  'التعلم الآله': 'machine learning',
  'التعلم الالي': 'machine learning',
  'التعلم العميق': 'deep learning',
  'التعلم المتعمق': 'deep learning',
  'تكنولوجيا المعلومات': 'information technology',
  'تقنيه المعلومات': 'information technology',
  'تقنيات المعلومات': 'information technology',
  'الذكاء الاصطناعي': 'artificial intelligence',
  'ذكاء اصطناعي': 'artificial intelligence',
  'شبكات عصبيه': 'neural networks',
  'معالجه اللغه الطبيعيه': 'natural language processing',
  'معالجه اللغات الطبيعيه': 'natural language processing',
  'الرؤيه بالحواسيب': 'computer vision',
  'رؤيه الحاسب': 'computer vision',
  'قواعد البيانات': 'database',
  'قاعده البيانات': 'database',
  'نظم المعلومات': 'information systems',
  'اداره الاعمال': 'business administration',
  'التسويق': 'marketing',
  'المحاسبه': 'accounting',
  'التمويل': 'finance',
  'الاقتصاد': 'economics',
  'الصيدله': 'pharmacy',
  'طب الاسنان': 'dentistry',
  'التمريض': 'nursing',
  'الطب': 'medicine',
  'الصحيه': 'health',
  'التعليم العالي': 'higher education',
  'التعليم': 'education',
  'الرياضيات': 'mathematics',
  'الفيزياء': 'physics',
  'الكيمياء': 'chemistry',
  'الاحياء': 'biology',
  'الحاسب': 'computer',
  'البرمجيات': 'software',
  'هندسة البرمجيات': 'software engineering',
  'امن المعلومات': 'information security',
  'التحصيل الدراسي': 'academic achievement',
  'الدافعية': 'motivation',
  'التعلم النشط': 'active learning',
  'الهندسه': 'engineering',
  'الزراعه': 'agriculture',
  'البيئه': 'environment',
  'القانون': 'law',
  'الاعلام': 'media',
  'المحليه': 'local',
  'الريفيه': 'rural',
  'الصحه النفسيه': 'mental health',
  'التعليم النوعي': 'inclusive education',
  'التواصل': 'communication',
  'الاداريه': 'administrative',
  'الماليه': 'financial'
};

/**
 * يبني استعلام البحث النهائي: الموضوع + مصطلحات إنجليزية مكافئة من العنوان/التخصص.
 * هذا ما يجعل النتائج «حسب تخصّص الباحث» فعلاً لا حسب الكلمات العامة.
 */
export function buildSearchQuery({ topic = '', title = '', field = '' } = {}) {
  const parts = [cleanQuery(topic, 160)];
  const haystack = `${topic} ${title} ${field}`.toLowerCase();
  const english = new Set();

  const hay = normalizeArabic(haystack);
  for (const [ar, en] of Object.entries(ARABIC_TERMS)) {
    // مطابقة العبارة ككلمات متتابعة مع حدود عربية صحيحة:
    // «التعلم العميق» تُطابق، و«الطب» لا تطابق «الطبيعيه».
    // توحيد أي مسافات (أو فواصل) بين كلمات العبارة لمطابقتها مهما تغيّر التنسيق.
    const key = normalizeArabic(ar).split(/\s+/).join('\\s+');
    if (new RegExp(`(?<!\\p{L})${key}(?!\\p{L})`, 'u').test(hay)) {
      en.split(' ').forEach((word) => english.add(word));
    }
  }

  // كلمات إنجليزية أصلاً في العنوان/التخصص (كثير من الباحثين يكتبون عنوانهم إنجليزياً).
  `${title} ${field}`
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && /^[a-z]/i.test(word))
    .slice(0, 5)
    .forEach((word) => english.add(word));

  const englishQuery = [...english].slice(0, 6).join(' ');
  if (englishQuery && englishQuery.toLowerCase() !== cleanQuery(topic).toLowerCase()) parts.push(englishQuery);

  return parts.filter(Boolean).join(' ').trim().slice(0, 220);
}

/**
 * درجة ملاءمة النتيجة لموضوع البحث (0–100).
 * العنوان أعلى وزناً لأنه موضوع الورقة، والملخص أقل وزناً.
 * التطبيع عربي (همزات/تاء مربوطة/تشكيل) حتى «أسماء» = «اسماء».
 */

/** الجزء الإنجليزي فقط من استعلام مختلط (يُستخدم للبحث الثاني في الأدوات العالمية). */
function englishTermsOf(query) {
  return String(query || '')
    .split(' ')
    .filter((word) => /^[a-z]/i.test(word))
    .join(' ')
    .slice(0, 200);
}

/**
 * درجة ملاءمة النتيجة بموضوع البحث (0–100): العنوان أعلى وزناً لأنه موضوع الورقة.
 */
export function relevanceScore(item, topic) {
  const haystacks = {
    title: normalizeArabic(item.title),
    venue: normalizeArabic(`${item.venue || ''} ${item.subjects || ''}`),
    abstract: normalizeArabic(item.abstract)
  };

  const terms = [...new Set(normalizeArabic(topic).split(' ').filter((word) => word.length > 2))];
  if (!terms.length) return 100; // بلا موضوع محدّد ⇒ لا ترشيح (نأخذ كل النتائج).

  let score = 0;
  for (const term of terms) {
    if (haystacks.title.includes(term)) score += 3;
    if (haystacks.venue.includes(term)) score += 1;
    if (haystacks.abstract.includes(term)) score += 0.5;
  }

  return Math.min(100, Math.round((score / (terms.length * 3)) * 100));
}

/** مفتاح تطبيع العنوان لاكتشاف تكرار العمل الواحد بين المصادر. */
function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^؀-ۿa-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 10)
    .join(' ');
}

/** يوحّد سجل مصدر خارجي إلى سجل مرجع واحد (نفس الشكل لكل المصادر). */
function normalise(record, sourceId) {
  const authors = String(record.authors || '')
    .split(/[،,]/)
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    title: String(record.title || '(بدون عنوان)').trim(),
    authors,
    authorText: String(record.authors || '').trim(),
    year: Number(record.year) || null,
    venue: String(record.venue || record.source || '').trim(),
    publisher: String(record.publisher || '').trim(),
    type: String(record.type || '').trim(),
    volume: String(record.volume || '').trim(),
    issue: String(record.issue || '').trim(),
    pages: String(record.pages || '').trim(),
    doi: String(record.doi || '').trim(),
    url: String(record.url || '').trim(),
    pdfUrl: String(record.pdfUrl || '').trim(),
    isOpenAccess: Boolean(record.isOpenAccess || record.pdfUrl),
    citations: Number(record.citations || 0),
    abstract: String(record.abstract || '').trim(),
    subjects: String(record.subjects || '').trim(),
    locator: String(record.locator || record.url || record.doi || '').trim(),
    sources: [sourceId]
  };
}

/** سطر استشهاد واحد (APA مبسّط) — يصلح للنسخ في فصل الرسالة. */
export function referenceLine(item) {
  const first = item.authors[0] || 'مؤلف غير محدد';
  const surname = first.split(' ').pop() || first;
  const more =
    item.authors.length > 2 ? ' et al.' : item.authors.length === 2 ? ` & ${item.authors[1].split(' ').pop()}` : '';
  const volume = item.volume ? `, ${item.volume}` : '';
  const issue = item.issue ? `(${item.issue})` : '';
  const pages = item.pages ? `, ${item.pages}` : '';
  const link = item.doi ? ` https://doi.org/${item.doi}` : item.url ? ` ${item.url}` : '';

  return `${surname}${more} (${item.year || '؟'}). ${item.title}. ${item.venue || item.publisher || ''}${volume}${issue}${pages}.${link}`;
}

/** هل المرجعان نفس العمل؟ (نفس DOI أو عنوان متطابق). */
function isDuplicate(a, b) {
  if (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) return true;
  const key = titleKey(a.title);
  return Boolean(key) && key === titleKey(b.title);
}

/**
 * بحث مراجع في عدة مصادر بالتوازي مع دمج النتائج وإزالة التكرار:
 * يعيد { query, sources, items, tried, errors } ولا يرمي أبداً.
 */
export async function searchLiterature({ query, sources = DEFAULT_SEARCH_SOURCES, limit = 8, subject = '', topic = '', minRelevance = 25 } = {}) {
  const q = cleanQuery(query);
  const ids = (Array.isArray(sources) ? sources : [sources]).map((id) => String(id || '').trim()).filter(Boolean);
  const list = (ids.length ? ids : DEFAULT_SEARCH_SOURCES).slice(0, 6);
  const size = Math.min(Math.max(Number(limit) || 8, 1), 15);
  // موضوع الترشيح: إن لم يُمرَّر نستخدم الاستعلام نفسه (سلوك البحث اليدوي).
  const filterTopic = cleanQuery(topic || q, 160);

  if (!q && !subject) {
    return { query: '', sources: list, items: [], tried: [], errors: [{ source: '—', error: 'اكتب كلمة بحث أولاً.' }] };
  }

  const tried = [];
  const errors = [];
  const settled = await Promise.allSettled(
    list.map(async (id) => {
      const started = Date.now();
      // مهلة لكل مصدر + مهلة شاملة: نردّ ما وصل فعلاً ولا نُبقي الباحث منتظراً.
      const response = await withBudget(
        searchExternalLibrary({ source: id, q, subject, limit: size }),
        SOURCE_BUDGET_MS,
        { source: id, results: [], error: 'تجاوز المصدر المهلة.' }
      );
      tried.push({ source: id, ms: Date.now() - started, count: response.results.length });
      if (response.error && !response.results.length) errors.push({ source: id, error: response.error });
      return response.results.map((record) => normalise(record, id));
    })
  );

  // حارس إضافي: لو تعلّق نداءٌ ما رغم المهلة، نكمل بما جمعناه.
  const guard = new Promise((resolve) => setTimeout(() => resolve([]), TOTAL_BUDGET_MS));
  const outcomes = await Promise.race([settled, guard]);

  const merged = [];
  for (const outcome of outcomes) {
    if (outcome.status !== 'fulfilled') continue;

    for (const item of outcome.value) {
      if (!item.title || item.title === '(بدون عنوان)') continue;

      const existing = merged.find((candidate) => isDuplicate(candidate, item));
      if (existing) {
        // نفس العمل من مصدر آخر: نأخذ أفضل رابط PDF وDOI وأعلى عدد استشهادات.
        if (!existing.pdfUrl && item.pdfUrl) existing.pdfUrl = item.pdfUrl;
        if (!existing.doi && item.doi) existing.doi = item.doi;
        if (!existing.isOpenAccess && item.isOpenAccess) existing.isOpenAccess = true;
        if (item.citations > existing.citations) existing.citations = item.citations;
        if (!existing.sources.includes(item.sources[0])) existing.sources.push(item.sources[0]);
        continue;
      }

      // درجة الملاءمة مع موضوع الباحث (تُحسب مرة واحدة لكل نتيجة).
      merged.push({ ...item, relevance: relevanceScore(item, filterTopic) });
    }
  }

  // ترتيب بالأولوية: ملاءمة الموضوع أولاً، ثم مفتوح الوصول، ثم الأحدث، ثم الاستشهادات.
  merged.sort(
    (a, b) =>
      (b.relevance || 0) - (a.relevance || 0) ||
      Number(Boolean(b.pdfUrl)) - Number(Boolean(a.pdfUrl)) ||
      (b.year || 0) - (a.year || 0) ||
      b.citations - a.citations
  );

  // ترشيح: عند وجود موضوع محدّد نستبعد النتائج التي لا تحتوي أي كلمة منه.
  // مهم: لا «نعود» للنتائج غير المطابقة أبداً — إرسال مراجع لا علاقة بالموضوع أسوأ
  // من سؤال الباحث عن موضوعه، فيعود فارغاً إن لم يجد مطابقة حقيقية.
  const scored = filterTopic ? merged.filter((item) => (item.relevance || 0) >= minRelevance) : merged;
  const finalItems = scored.slice(0, size);

  return {
    query: q,
    topic: filterTopic,
    sources: list,
    items: finalItems,
    tried,
    errors,
    filteredOut: merged.length - scored.length
  };
}

/**
 * كتلة مراجع محقّقة تُحقن في رسالة المشرف الذكي، مع تعليمات تمنع تخمين الروابط.
 */
export function literatureBlock(result, { max = 6, libraryItems = [], topicSource = '' } = {}) {
  const items = (result?.items || []).slice(0, max);
  if (!items.length && !libraryItems.length) return '';

  // إن لم تتجاوز أي نتيجة حدّ الملاءمة ⇒ نتائج ضعيفة الصلة بالموضوع.
  const weak = Boolean(items.length) && items.every((item) => (item.relevance || 0) < 25);

  const lines = items.map((item, index) => {
    const bits = [
      `[${index + 1}] ${item.title}`,
      item.authorText ? `المؤلفون: ${item.authorText}` : '',
      item.venue ? `المصدر أو المجلة: ${item.venue}` : '',
      item.year ? `السنة: ${item.year}` : '',
      item.doi ? `DOI: ${item.doi}` : '',
      item.pdfUrl ? `PDF مفتوح: ${item.pdfUrl}` : item.url ? `الرابط: ${item.url}` : 'بلا رابط مباشر',
      item.isOpenAccess ? 'نسخة مفتوحة متاحة' : ''
    ].filter(Boolean);

    return `- ${bits.join(' | ')}`;
  });

  // كتب مكتبة المنصة: ما يستطيع الباحث قراءته وتحميله فوراً بلا روابط خارجية.
  const libraryLines = libraryItems.map((item) => {
    const access = item.hasFile
      ? 'متاح للقراءة والتحميل داخل المنصة'
      : item.externalUrl
        ? `رابط المصدر: ${item.externalUrl}`
        : 'بيانات فقط';

    return [
      `- [مكتبة المنصة] ${item.title}`,
      item.authorsText || (Array.isArray(item.authors) && item.authors.length ? item.authors.join('، ') : '')
        ? `المؤلفون: ${item.authorsText || item.authors.join('، ')}`
        : '',
      item.year ? `السنة: ${item.year}` : '',
      item.venue || item.source ? `المصدر: ${item.venue || item.source}` : '',
      item.doi ? `DOI: ${item.doi}` : '',
      item.enriched ? 'بياناته مستخرجة من رابط المصدر' : '',
      access
    ]
      .filter(Boolean)
      .join(' | ');
  });

  return [
    '== نتائج بحث حقيقية (استخدمها في إجابتك) ==',
    ...(libraryLines.length ? ['-- من مكتبة المنصة (يمكن للباحث قراءتها وتحميلها الآن) --', ...libraryLines, ''] : []),
    '-- من قواعد البيانات الخارجية --',
    ...lines,
    weak
      ? 'تنبيه جودة: صلة هذه النتائج بموضوع الباحث ضعيفة (قواعد البيانات لم تجد مطابقة قوية) — قولي له ذلك بصراحة واطلب منه كلمات مفتاحية أدق أو عنواناً إنجليزياً لبحثه.'
      : '',
    // نُفصح للباحث عن العبارة التي بُني عليها البحث حتى يصحّحها إن أخطأنا.
    topicSource === 'profile'
      ? 'ملاحظة: بُني هذا البحث على ملف الباحث (عنوان بحثه وتخصصه) — اذكري ذلك في أول جملة واطلبه التأكيد.'
      : topicSource === 'context'
        ? 'ملاحظة: بُني هذا البحث على سياق محادثتنا السابقة — اذكري أنك استخدمته واطلبه التصحيح إن لم يكن موضوعه.'
        : '',
    'تعليمات:',
    libraryLines.length
      ? '1) ابدئي بذكر عناصر مكتبة المنصة أولاً ووضّحي للباحث أنها قابلة للقراءة والتحميل الآن من صفحة «مراجعي»، ثم اذكري نتائج قواعد البيانات الخارجية.'
      : '1) اعتمدي على هذه البيانات فقط عند ذكر مرجع أو رابط أو رقم صفحة — لا تختلقي DOI ولا رابطاً ولا اسم مجلة.',
    '2) اذكري العنوان والمؤلف والسنة والمجلة كما هي هنا ثم تضعي الرابط.',
    '3) إن لم تكفِ النتائج فقل للباحث صراحةً ما الذي يبحث عنه بالضبط لتوسيع البحث.',
    '== نهاية نتائج البحث =='
  ].join('\n');
}

/**
 * هل يطلب الباحث مراجع/مصادر فعلاً؟ كلمات مفتاحية عربية وإنجليزية —
 * الهدف تشغيل الأداة تلقائياً بلا سؤال إضافي للباحث.
 */
export function wantsLiterature(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return false;

  const arabic = /(مرجع|مراجع|مصدر|مصادر|توثيق|استشهاد|اقتباس|أوراق بحثية|اوراق بحثية|مقالات|ابحث لي عن|اقترح لي|apa\b|doi\b)/;
  const english =
    /(reference|references|citation|citations|bibliograph|papers?|articles?|sources?|doi\b|related work|state of the art|apa\b)/;

  return arabic.test(raw) || english.test(raw);
}

/**
 * يدمج قائمتي نتائج (بحث عربي + بحث إنجليزي) مع إزالة التكرار بالـ DOI/العنوان،
 * مع الحفاظ على أعلى درجة ملاءمة لكل عمل.
 */
export function mergeItems(...lists) {
  const merged = [];

  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.title || item.title === '(بدون عنوان)') continue;
      const existing = merged.find((candidate) => isDuplicate(candidate, item));
      if (!existing) {
        merged.push({ ...item });
        continue;
      }
      if (!existing.pdfUrl && item.pdfUrl) existing.pdfUrl = item.pdfUrl;
      if (!existing.doi && item.doi) existing.doi = item.doi;
      if (!existing.isOpenAccess && item.isOpenAccess) existing.isOpenAccess = true;
      if ((item.relevance || 0) > (existing.relevance || 0)) existing.relevance = item.relevance;
      if (item.citations > existing.citations) existing.citations = item.citations;
      for (const source of item.sources || []) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      }
    }
  }

  return merged.sort(
    (a, b) =>
      (b.relevance || 0) - (a.relevance || 0) ||
      Number(Boolean(b.pdfUrl)) - Number(Boolean(a.pdfUrl)) ||
      (b.year || 0) - (a.year || 0) ||
      b.citations - a.citations
  );
}

/** القيم التي تعني «غير محدد» في ملف الباحث — لا تصلح موضوعاً للبحث. */
const PLACEHOLDERS = /^(غير محدد|غير محدده|محدد|محدد؟|-{1,2}|—|؟|\?|n\/?a|غير معروف|غير محدد\?)$/i;

/**
 * يحدّد **موضوع البحث** من مصادر بالترتيب، ويعيد مصدره ليتصرّف معه المشرف:
 *   1) subject  ⇒ الموضوع موجود في سؤال الباحث نفسه («مراجع عن التعلم العميق»).
 *   2) profile  ⇒ لا موضوع في السؤال ⇒ نستخدم **ملف الباحث** (العنوان + التخصص).
 *   3) context  ⇒ لا شيء في الملف ⇒ نستنبطه من **سياق المحادثات** (المهمة المتفق عليها
 *                    وملخّص الذاكرة وآخر أسئلة الباحث).
 *   4) none     ⇒ لا نعرف التخصّص ⇒ **لا نرسل أي مرجع**، ونطلب الموضوع من الباحث.
 */
export function resolveTopic({ question = '', title = '', field = '', context = '' } = {}) {
  const explicit = extractTopic(question);
  if (explicit.length >= 3) return { topic: explicit, origin: 'subject' };

  const cleanTitle = String(title || '').trim();
  const cleanField = String(field || '').trim();
  const hasTitle = cleanTitle && !PLACEHOLDERS.test(cleanTitle);
  const hasField = cleanField && !PLACEHOLDERS.test(cleanField);

  if (hasTitle || hasField) {
    return { topic: cleanQuery(`${hasTitle ? cleanTitle : ''} ${hasField ? cleanField : ''}`, 160).trim(), origin: 'profile' };
  }

  // من سياق المحادثة: نأخذ أهم الجمل فقط (المهمة المتفق عليها ثم آخر كلام للباحث).
  const fromContext = extractTopic(context);
  if (fromContext.length >= 8) return { topic: fromContext.slice(0, 160), origin: 'context' };

  return { topic: '', origin: 'none' };
}

/** (unused) كان بوابة المرحلة — أُلغيت: المراجع متاحة في كل مرحلة عدا topic.
 * kept for backward compatibility of imports; الأداة لم تعد تستدعيها. */
export const REFERENCE_STEPS = ['literature'];

export function isReferenceStage(stepKey) {
  return REFERENCE_STEPS.includes(String(stepKey || '').trim());
}

/**
 * أداة المراجع — تُشغَّل في **أي مرحلة** بلا بوابة، بشرط واحد:
 * أن يذكر الباحث **العنوان** الذي يريد مراجعه. إن لم يذكره ⇒ نسأل ولا نرسل شيئاً.
 * والمراجع تبقى ضمن نطاق تخصصه (ملفه البحثي) لأنه يُضاف إلى الاستعلام والترشيح.
 */

/**
 * هل الموضوع **محدَّد بما يكفي** للبحث؟ حقل عام مثل «تقنية المعلومات» (كلمتان)
 * لا ينتج مراجع في تخصّصه، لأن قواعد البيانات ترجّع أي شيء. نقيس:
 *   - عدد الكلمات العربية/الإنجليزية ذات المعنى (بعد حذف الكلمات الوظيفية).
 *   - هل هو مجرد اسم تخصص عام بلا متخصص فرعي؟
 */
export function isTopicSpecific(topic, { minWords = 4 } = {}) {
  const words = normalizeArabic(topic)
    .split(' ')
    .filter((word) => word.length > 2);

  if (words.length >= minWords) return true;

  // كلمتان بالضبط («تقنية المعلومات») = اسم تخصص عام ⇒ نحتاج توضيحاً.
  return false;
}

/**
 * يستخرج موضوع البحث **كما كتبه الباحث** من رسالته، ليمكن تسجيله في خطته:
 *   - «موضوعي: …» / «سأبحث عن …» / «موضوع بحثي …» / «بعنوان …» / «my topic is …»
 * يعيد نصاً فارغاً إن لم يصرّح بموضوع (لا نخمّن ولا نؤلّف من عندنا).
 */
export function extractStatedTopic(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 600) return '';

  const patterns = [
    /(?:موضوعي|موضوع بحثي|موضوع رسالة|عنوان بحثي|عنوان الرسالة|سأبحث عن|ببحث عن|سأعمل على|سأختار)\s*[:：\-–]?\s*(.{6,200})/,
    /(?:بعنوان|بعنوان البحث|عنوانه|عنوانها)\s*[:：\-–]?\s*(.{6,200})/,
    /(?:my (?:topic|title|research) is|research (?:topic|title))\s*[:：\-–]?\s*(.{6,200})/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    const value = String(match?.[1] || '')
      .replace(/\s+/g, ' ')
      .replace(/[؟?!.،,؛;]+$/g, '')
      .trim();

    // نقبل عبارة واحدة واضحة (٦ أحرف فأكثر) بلا قوائم أسئلة.
    if (value.length >= 6 && value.length <= 200 && !/[؟?]/.test(value)) return value;
  }

  return '';
}

/**
 * الأداة كاملة كما تُستدعى من شات المشرف الذكي.
 * تُرجع { block, items } عند وجود موضوع، أو { needsTopic } حين لا نعرف التخصّص
 * أو لم نجد مطابقة حقيقية (وقتها يطلب المشرف من الباحث موضوعه بدل مراجع عامة).
 */
export async function literatureToolFor(
  userText,
  { limit = 6, userId = null, field = '', title = '', context = '', askedBefore = false } = {}
) {
  // إن سألناه سابقاً عن العنوان فأي جواب ذي معنى يُعامَل كطلب مراجع
  // (مثل «ضمن تخصصي» الذي لا يحتوي كلمة «مراجع»).
  const isAnswerToOurQuestion = askedBefore && normalizeArabic(userText).trim().length >= 4;
  if (!wantsLiterature(userText) && !isAnswerToOurQuestion) return null;

  /*
   * القاعدة الجديدة (قرار صاحب المنصة):
   *   - المراجع تُقترح في أي مرحلة عدا «تحديد المشكلة» (topic): بوابة chat.js
   *     تمنع الأداة قبل اكتمال تعريف المشكلة وحدودها.
   *   - لكن **نسأل عن العنوان أولاً**: لا نرسل مراجع عامة أبداً.
   *   - العنوان يأتي من كلام الباحث نفسه، والمراجع تُبقي داخل نطاق تخصّصه
   *     (نضيف تخصّصه للاستعلام ونستخدمه في الترشيح).
   */
  const asked = extractTopic(userText);

  // «ضمن تخصصي / في مجالي / تخصص تقنية المعلومات» = إجابة عن سؤالنا ⇒ نبحث في نطاق ملفه.
  const wantsScope = /(ضمن\s*(?:تخصص|مجال|بحث)|تخصصي|مجالي|مجال\s*(?:بحث|تخصص))/i.test(userText);
  const profileScope = cleanQuery(`${title || ''} ${field || ''}`, 200).trim();

  let topic = '';
  let origin = 'subject';

  if (wantsScope && profileScope) {
    topic = profileScope;
    origin = 'profile';
  } else if (isTopicSpecific(asked)) {
    topic = asked;
    origin = 'subject';
  } else if (askedBefore && profileScope) {
    // أجاب بلا عنوان ⇒ لا نسأل مرة ثانية، بل نبحث في نطاق بحثه المسجَّل.
    topic = profileScope;
    origin = 'profile';
  } else {
    return { needsTopic: true, reason: 'need_title' };
  }

  if (!isTopicSpecific(topic)) return { needsTopic: true, reason: 'need_title', topic };

  // 3) الاستعلام النهائي = الموضوع + مصطلحاته الإنجليزية (لتطابق قواعد البيانات العالمية).
  const query = buildSearchQuery({ topic, title, field });
  const filterTopic = origin === 'profile' ? topic : `${topic} ${field} ${title}`.trim();
  const hasArabic = /[\u0600-\u06FF]/.test(topic);

  const started = Date.now();

  // 4) بحثان متوازيان: بالموضوع المختلط (عربي+إنجليزي)، وبالإنجليزية وحدها
  //    حين يكون الموضوع عربياً — لالتقاط أوراق IEEE/ACM التي لا تُفهرَس بالعربية.
  const [mixed, englishOnly] = await Promise.all([
    searchLiterature({ query, limit: limit + 2, topic: filterTopic }),
    hasArabic
      ? searchLiterature({ query: englishTermsOf(query), limit: limit + 2, topic: filterTopic, sources: ['crossref', 'openalex'] })
      : Promise.resolve({ items: [] })
  ]);

  const items = mergeItems(mixed.items, englishOnly.items).slice(0, limit);

  // لم نجد مطابقة حقيقية للموضوع ⇒ لا مراجع عشوائية: نطلب توضيحاً من الباحث.
  if (!items.length) return { needsTopic: true, reason: 'no_match', topic, topicSource: origin };

  // بالتوازي: ما عندنا في مكتبة المنصة (يُقرأ ويُحمَّل فوراً) — وبنفس شرط الملاءمة
  // حتى لا يدخل عنصر المكتبة غير المرتبط بالموضوع.
  const libraryItems = (await searchPlatformLibrary({ query: topic, field, userId, limit: 6 }))
    .filter((item) => relevanceScore(item, topic) >= 25)
    .slice(0, 4);

  if (!items.length && !libraryItems.length) return { needsTopic: true, reason: 'no_match', topic, topicSource: origin };

  return {
    block: literatureBlock({ items }, { max: limit, libraryItems, topicSource: origin }),
    items,
    libraryItems,
    topic,
    topicSource: origin,
    query,
    ms: Date.now() - started
  };
}

export { googleScholarUrl, resolveDoiRecord };

/**
 * مراجع من مكتبة المنصة (ما أضافه المدير): تُبحث بسؤال الباحث وبتخصّصه،
 * وهي قابلة للقراءة والتحميل فوراً بلا روابط خارجية.
 */
export async function searchPlatformLibrary({ query, field = '', userId = null, limit = 4 } = {}) {
  const q = cleanQuery(query, 120);
  const size = Math.min(Math.max(Number(limit) || 4, 1), 8);
  const items = [];

  // ثلاث محاولات متتالية حتى نجد ما في المكتبة:
  //  1) بالعبارة كاملة (كل الكلمات) — 2) بمصطلحاتها الإنجليزية — 3) بأي كلمة (تساهل).
  const english = q
    .split(' ')
    .filter((word) => /^[a-z]/i.test(word))
    .join(' ');

  const attempts = [
    { q, match: 'all' },
    english && english !== q ? { q: english, match: 'all' } : null,
    { q, match: 'any' },
    field ? { q: cleanQuery(field, 60), match: 'any' } : null
  ].filter(Boolean);

  for (const attempt of attempts) {
    if (items.length) break;
    try {
      items.push(...(await searchLibraryItems({ userId, q: attempt.q, limit: size, match: attempt.match })));
    } catch (error) {
      console.warn(`تعذّر البحث في مكتبة المنصة: ${error?.code || error?.message}`);
    }
  }

  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const chosen = unique.sort((a, b) => Number(Boolean(b.hasFile)) - Number(Boolean(a.hasFile))).slice(0, size);
  // نُعيد نسخاً قابلة للتعديل: الإثراء يأتي من الرابط ولا يمسّ بيانات المنصة.

  // عناصر المكتبة التي بلا ملف ⇒ **نقرأ بياناتها من رابطها** (وسوم citation_*)
  // فيحصل الباحث على المجلة والمؤلفين والسنة وDOI بدل سطر ناقص.
  const enrichedById = new Map();
  await Promise.all(
    chosen
      .filter((item) => !item.hasFile && item.externalUrl)
      .slice(0, 3)
      .map(async (entry) => {
        const item = { ...entry };
        try {
          const meta = await fetchCitationMetadata(item.externalUrl);
          if (!meta?.title) return;
          // العنوان المسجَّل في المنصة يبقى المرجع للترشيح والمطابقة،
          // والرابط يملأ ما هو ناقص فقط (المجلّة · السنة · DOI · رابط PDF).
          item.linkTitle = meta.title;
          item.authors = item.authors?.length ? item.authors : meta.authors;
          item.authorsText = item.authorsText || meta.authorText;
          item.year = item.year || meta.year;
          item.venue = item.venue || meta.venue;
          item.doi = item.doi || meta.doi;
          item.publisher = meta.publisher;
          item.pdfUrl = item.pdfUrl || meta.pdfUrl;
          item.abstract = item.abstract || meta.abstract;
          item.enriched = true;
          enrichedById.set(item.id, item);
        } catch (error) {
          console.warn(`تعذّرت قراءة بيانات الرابط: ${error?.code || error?.message}`);
        }
      })
  );

  return chosen.map((item) => enrichedById.get(item.id) || item);
}

/**
 * أداة الباحث اليدوية: يكتب العنوان **أو رابطاً أو DOI** فيُحلّ إلى بيانات مرجعية
 * كاملة (المؤلفون · المجلة · الناشر · السنة · المجلد/العدد/الصفحات · رابط الناشر
 * · نسخة PDF مفتوحة عبر Unpaywall). تعيد { record } أو { record: null, error }.
 */
export async function resolveReference(input) {
  const raw = String(input || '').trim();
  if (!raw) return { record: null, error: 'اكتب عنواناً أو رابطاً أو DOI.' };

  // DOI أو رابط doi.org ⇒ الحلّ المباشر (أدق وأسرع).
  const record = await resolveDoiRecord(raw);
  if (record) return { record };

  // غير DOI ⇒ نبحث بالعبارة كما هي ثم نعيد أول نتيجة مؤكَّدة.
  const result = await searchLiterature({ query: raw, limit: 1, sources: ['crossref', 'openalex'] });
  if (result.items.length) return { record: result.items[0] };

  return { record: null, error: 'لم أجد عملاً بهذه العبارة — جرّب عنواناً إنجليزياً أو DOI.' };
}