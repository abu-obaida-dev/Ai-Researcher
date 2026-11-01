/** Searches scholarly sources, normalizes citations, and filters results by research topic. */

/** Query cleanup and relevance filtering keep generic reference requests on-topic. */
import { LIBRARY_SOURCES, fetchCitationMetadata, googleScholarUrl, normalizeYearRange, searchExternalLibrary } from './library-sources.js';
import { registeredTopic } from './journey.js';
import { normalizeArabic, searchLibraryItems } from './workspace.js';

// Re-export shared Arabic normalization for library services.
export { normalizeArabic };

// The registered journey topic is the authoritative search topic.
export { registeredTopic };

/** Default sources searched in parallel. */
export const DEFAULT_SEARCH_SOURCES = ['crossref', 'openalex', 'semantic'];

/** Source IDs exposed by the library interface. */
export const WEB_SOURCES = LIBRARY_SOURCES.map((entry) => entry.id);

/** Per-source deadline in multi-source searches. */
const SOURCE_BUDGET_MS = 12000;

/** Resolves with a fallback when a source exceeds its time budget. */
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

/** Maximum search-query length. */
function cleanQuery(value, max = 200) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}


/** Removes request phrasing so only the research topic is searched. */
const REQUEST_PHRASES =
  /(اديني|اعطني|اعطنى|اريد|أريد|ابغى|أبغى|بدي|محتاج|محتاجه|محتاجة|محتاجي|ابحث لي عن|ابحث عن|اقترح لي|اقترح|أقترح|ابحث|أبحث|استخرج|ساعدني في|ساعدني|لو سمحت|من فضلك|قائمه|قائمة|اسماء|أسماء|الاسماء|مراجع|مصدر|مصادر|اوراق|أوراق|مقالات|ابحاث|أبحاث|نتائج|اعمال|أعمال|رسائل)/g;

/** Stopwords are removed only as complete words to avoid corrupting longer terms. */
const SHORT_STOPWORDS = [
  'في', 'عن', 'مع', 'من', 'على', 'الى', 'إلى', 'كل', 'بعض', 'لي', 'لك', 'أي', 'او', 'أو', 'حول', 'هذا', 'هذه', 'ذلك', 'عند', 'حيث',
  'how', 'on', 'in', 'of', 'the', 'for', 'and', 'or', 'my', 'a', 'an', 'to', 'about', 'part', 'chapter'
];

/** Removes stopwords using Unicode letter boundaries. */
function removeShortStopwords(text) {
  let out = String(text || '');
  for (const word of SHORT_STOPWORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'giu'), ' ');
  }
  return out;
}

/** Extracts the research topic from the user's request. */
export function extractTopic(userText) {
  return removeShortStopwords(normalizeArabic(userText).replace(REQUEST_PHRASES, ' '))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Maps common Arabic academic terms to English search terms. */
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

/** Builds a topic query with English terms derived from title and field. */
export function buildSearchQuery({ topic = '', title = '', field = '' } = {}) {
  const parts = [cleanQuery(topic, 160)];
  const haystack = `${topic} ${title} ${field}`.toLowerCase();
  const english = new Set();

  const hay = normalizeArabic(haystack);
  for (const [ar, en] of Object.entries(ARABIC_TERMS)) {
    // Match normalized phrases at Unicode word boundaries.
    const key = normalizeArabic(ar).split(/\s+/).join('\\s+');
    if (new RegExp(`(?<!\\p{L})${key}(?!\\p{L})`, 'u').test(hay)) {
      en.split(' ').forEach((word) => english.add(word));
    }
  }

  // Preserve English terms already present in the title or field.
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

/** Scores result relevance, weighting titles above abstracts. */

/** Extracts English terms for a second global-source search. */
function englishTermsOf(query) {
  return String(query || '')
    .split(' ')
    .filter((word) => /^[a-z]/i.test(word))
    .join(' ')
    .slice(0, 200);
}

/** Scores a result against the research topic. */
export function relevanceScore(item, topic) {
  const haystacks = {
    title: normalizeArabic(item.title),
    venue: normalizeArabic(`${item.venue || ''} ${item.subjects || ''}`),
    abstract: normalizeArabic(item.abstract)
  };

  const terms = [...new Set(normalizeArabic(topic).split(' ').filter((word) => word.length > 2))];
  if (!terms.length) return 100; // No topic means no filtering.

  let score = 0;
  for (const term of terms) {
    if (haystacks.title.includes(term)) score += 3;
    if (haystacks.venue.includes(term)) score += 1;
    if (haystacks.abstract.includes(term)) score += 0.5;
  }

  return Math.min(100, Math.round((score / (terms.length * 3)) * 100));
}

/** Normalizes titles for cross-source deduplication. */
function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^؀-ۿa-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 10)
    .join(' ');
}

/** Normalizes external-source records to a shared reference shape. */
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

/** Builds a simple APA-style citation line. */
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

/** Checks whether two records refer to the same work. */
function isDuplicate(a, b) {
  if (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) return true;
  const key = titleKey(a.title);
  return Boolean(key) && key === titleKey(b.title);
}

/** Searches selected sources in parallel, merges duplicates, and returns source errors. */
export async function searchLiterature({ query, sources, limit = 8, allSources = false, subject = '', topic = '', minRelevance = 25, yearFrom = 0, yearTo = 0 } = {}) {
  const q = cleanQuery(query);
  const defaultIds = allSources ? WEB_SOURCES : DEFAULT_SEARCH_SOURCES;
  const sourceIds = sources == null ? defaultIds : Array.isArray(sources) ? sources : [sources];
  const requestedIds = sourceIds
    .map((id) => String(id || '').trim())
    .filter((id, index, values) => id && values.indexOf(id) === index && WEB_SOURCES.includes(id));
  const selectedIds = requestedIds.length ? requestedIds : defaultIds;
  const list = allSources ? selectedIds : selectedIds.slice(0, 6);
  const size = Math.min(Math.max(Number(limit) || 8, 1), 25);
  // Use the query as the relevance topic when none is provided.
  const filterTopic = cleanQuery(topic || q, 160);
  // Normalize the requested publication-year range.
  const years = normalizeYearRange(yearFrom, yearTo);
  const hasYearFilter = Boolean(years.from || years.to);

  if (!q && !subject) {
    return { query: '', sources: list, items: [], tried: [], errors: [{ source: '—', error: 'اكتب كلمة بحث أولاً.' }] };
  }

  const tried = [];
  const errors = [];
  const settled = await Promise.allSettled(
    list.map(async (id) => {
      const started = Date.now();
      // Bound each source request so one slow source does not delay the response.
      const response = await withBudget(
        searchExternalLibrary({ source: id, q, subject, limit: size, yearFrom: years.from, yearTo: years.to }),
        SOURCE_BUDGET_MS,
        { source: id, results: [], error: 'تجاوز المصدر المهلة.' }
      );
      tried.push({ source: id, ms: Date.now() - started, count: response.results.length });
      if (response.error && !response.results.length) errors.push({ source: id, error: response.error });
      return response.results.map((record) => normalise(record, id));
    })
  );

  const outcomes = await settled;

  const merged = [];
  for (const outcome of outcomes) {
    if (outcome.status !== 'fulfilled') continue;

    for (const item of outcome.value) {
      if (!item.title || item.title === '(بدون عنوان)') continue;

      const existing = merged.find((candidate) => isDuplicate(candidate, item));
      if (existing) {
        // Merge access links and citation data from duplicate records.
        if (!existing.pdfUrl && item.pdfUrl) existing.pdfUrl = item.pdfUrl;
        if (!existing.doi && item.doi) existing.doi = item.doi;
        if (!existing.isOpenAccess && item.isOpenAccess) existing.isOpenAccess = true;
        if (item.citations > existing.citations) existing.citations = item.citations;
        if (!existing.sources.includes(item.sources[0])) existing.sources.push(item.sources[0]);
        continue;
      }

      // Calculate relevance once per unique record.
      merged.push({ ...item, relevance: relevanceScore(item, filterTopic) });
    }
  }

  // Exclude records without a confirmed year when a year range is requested.
  const ranged = hasYearFilter
    ? merged.filter(
        (item) =>
          item.year &&
          (!years.from || item.year >= years.from) &&
          (!years.to || item.year <= years.to)
      )
    : merged;

  // Rank by relevance, open access, recency, then citation count.
  ranged.sort(
    (a, b) =>
      (b.relevance || 0) - (a.relevance || 0) ||
      Number(Boolean(b.pdfUrl)) - Number(Boolean(a.pdfUrl)) ||
      (b.year || 0) - (a.year || 0) ||
      b.citations - a.citations
  );

  // Never fall back to unrelated references when a topic is specified.
  const scored = filterTopic ? ranged.filter((item) => (item.relevance || 0) >= minRelevance) : ranged;
  const finalItems = scored.slice(0, allSources ? size * list.length : size);

  return {
    query: q,
    topic: filterTopic,
    sources: list,
    items: finalItems,
    tried,
    errors,
    years,
    filteredOut: merged.length - scored.length
  };
}

/** Formats verified references for prompt injection without inventing links. */
export function literatureBlock(result, { max = 6, libraryItems = [], topicSource = '' } = {}) {
  const items = (result?.items || []).slice(0, max);
  if (!items.length && !libraryItems.length) return '';

  // Mark the result set as weak when every item falls below the relevance threshold.
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

  // Platform-library books are immediately readable without external links.
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
    // Expose the search phrase so the user can correct it if needed.
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

/** Detects explicit reference and source requests. */
export function wantsLiterature(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return false;

  const arabic = /(مرجع|مراجع|مصدر|مصادر|توثيق|استشهاد|اقتباس|أوراق بحثية|اوراق بحثية|مقالات|ابحث لي عن|اقترح لي|apa\b|doi\b)/;
  const english =
    /(reference|references|citation|citations|bibliograph|papers?|articles?|sources?|doi\b|related work|state of the art|apa\b)/;

  return arabic.test(raw) || english.test(raw);
}

/** Detects whether the assistant previously asked for a specific reference topic. */
export function askedForReferenceTitle(messages = [], limit = 3) {
  return messages.slice(-limit).some((message) => {
    if (message?.role !== 'assistant') return false;
    const text = String(message.content || '');
    if (!text || !/[؟?]/.test(text)) return false;
    if (/في أي عنوان|أي عنوان بالتحديد/.test(text)) return true;
    // Require a direct reference request near the question word.
    if (/(?:تريد|تحتاج|أعطني|أرني|ابحث لي|اقترح لي).{0,30}(?:مراجع|مصادر|روابط)/.test(text)) return true;
    // Exclude words such as "مراجعات" that are not requests for references.
    const wantsRefs = /(?:مراجع|مصادر|مرجع|مصدر)(?!ات)/.test(text);
    const mentionsTitle = /(عنوان|موضوع)/.test(text);
    const requestForm = /(ما هو|ما\s+(?:عنوان|موضوع)|اذكر|حدّد|حدد|تريد|تطلب|تحتاج)/.test(text);
    return wantsRefs && mentionsTitle && requestForm;
  });
}

/** Merges search results, removes duplicates, and keeps the best relevance score. */
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

/** Profile placeholder values that are not valid search topics. */
const PLACEHOLDERS = /^(غير محدد|غير محدده|محدد|محدد؟|-{1,2}|—|؟|\?|n\/?a|غير معروف|غير محدد\?)$/i;

/**
 * Resolves the research topic from the question, profile, or conversation context.
 * Returns its origin so the caller can handle missing topics appropriately.
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

  // Use the agreed task and the researcher's latest message from conversation context.
  const fromContext = extractTopic(context);
  if (fromContext.length >= 8) return { topic: fromContext.slice(0, 160), origin: 'context' };

  return { topic: '', origin: 'none' };
}

/** Legacy stage helper retained for import compatibility; the search tool does not use it. */
export const REFERENCE_STEPS = ['literature'];

export function isReferenceStage(stepKey) {
  return REFERENCE_STEPS.includes(String(stepKey || '').trim());
}

/** Searches references after the researcher specifies a topic and field. */

/**
 * Checks whether a topic is specific enough for a useful literature search.
 * Broad fields alone tend to return unrelated results.
 */
export function isTopicSpecific(topic, { minWords = 4 } = {}) {
  const words = normalizeArabic(topic)
    .split(' ')
    .filter((word) => word.length > 2);

  if (words.length >= minWords) return true;

  // Two-word fields such as "information technology" need clarification.
  return false;
}

/** Extracts an explicitly stated research topic without inferring one. */
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

    // Accept one clear phrase of at least six characters, not a question.
    if (value.length >= 6 && value.length <= 200 && !/[؟?]/.test(value)) return value;
  }

  return '';
}

/** Searches for relevant references or asks for a more specific topic. */
export async function literatureToolFor(
  userText,
  { limit = 6, userId = null, field = '', title = '', context = '', askedBefore = false } = {}
) {
  // Treat a meaningful answer to a previous topic prompt as a reference request.
  const isAnswerToOurQuestion = askedBefore && normalizeArabic(userText).trim().length >= 4;
  if (!wantsLiterature(userText) && !isAnswerToOurQuestion) return null;

  /*
   * Search only after the topic is defined, and never return generic references.
   * Use the researcher's stated topic and keep results within their field.
   */
  const asked = extractTopic(userText);

  // Scope-only replies use the research topic saved in the profile.
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
    // Do not repeat the prompt; fall back to the saved research topic.
    topic = profileScope;
    origin = 'profile';
  } else {
    return { needsTopic: true, reason: 'need_title' };
  }

  if (!isTopicSpecific(topic)) return { needsTopic: true, reason: 'need_title', topic };

  // Include English equivalents to improve coverage in global databases.
  const query = buildSearchQuery({ topic, title, field });
  const filterTopic = origin === 'profile' ? topic : `${topic} ${field} ${title}`.trim();
  const hasArabic = /[\u0600-\u06FF]/.test(topic);

  const started = Date.now();

  // Search mixed-language terms and, for Arabic topics, English-only terms in parallel.
  const [mixed, englishOnly] = await Promise.all([
    searchLiterature({ query, limit: limit + 2, topic: filterTopic }),
    hasArabic
      ? searchLiterature({ query: englishTermsOf(query), limit: limit + 2, topic: filterTopic, sources: ['crossref', 'openalex'] })
      : Promise.resolve({ items: [] })
  ]);

  const items = mergeItems(mixed.items, englishOnly.items).slice(0, limit);

  // Ask for clarification instead of returning unrelated references.
  if (!items.length) return { needsTopic: true, reason: 'no_match', topic, topicSource: origin };

  // Search the platform library in parallel and apply the same relevance threshold.
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

export { googleScholarUrl };

/** Searches the platform library for references relevant to the topic and field. */
export async function searchPlatformLibrary({ query, field = '', userId = null, limit = 4 } = {}) {
  const q = cleanQuery(query, 120);
  const size = Math.min(Math.max(Number(limit) || 4, 1), 8);
  const items = [];

  // Try the full phrase, its English terms, then individual keywords.
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
  // Enrich copies only; external metadata must not change platform records.

  // Fill missing citation metadata from source links when no file is available.
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
          // Keep the stored title for matching; use the link only to fill missing metadata.
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
