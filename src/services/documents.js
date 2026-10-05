import { inflateSync, inflateRawSync } from 'node:zlib';
import JSZip from 'jszip';
import { readSpreadsheet } from './spreadsheet.js';

/**
 * استخراج نصّ من ملفات الباحث — حتى يقرأها المشرف الذكي فعلاً.
 *
 * ما كان سابقاً: txt/md/csv/xlsx فقط، فكانت ملفات **PDF و DOCX** (وهي أغلب ما
 * يرفعه الباحث: فصول وملفات Word) تُحسم بـ«تعذّر استخراج نصّ» ⇒ لا يعرف المشرف شيئاً.
 *
 * المعالجات: txt/md/csv (نصّ) · xlsx/xls (ExcelJS) · docx (ZIP ⇒ word/document.xml)
 * · pdf (مستخرِج خفيف بـ zlib + خرائط ToUnicode). والباقي (صور/zip/doc القديم) ⇒
 * رسالة واضحة للباحث بدل تمرير حروف عشوائية للنموذج.
 */

/** أقصى نصّ من ملف واحد (حرف) — يحمي السياق من التضخّم. */
const MAX_CHARS_PER_FILE = 120000;

/** أقصى حجم ملف نحاول تحليله (20 MB). */
const MAX_PARSE_BYTES = 20 * 1024 * 1024;

/** فكّ كيانات XML الشائعة في Word. */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32))
    .replace(/&amp;/g, '&');
}

/** XML ⇒ نصّ مع الحفاظ على الفقرات والجداول كأسطر. */
function xmlToText(xml) {
  return decodeXmlEntities(
    String(xml || '')
      .replace(/<\/(w:p|w:tr)>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** استخراج نصّ Word من .docx (ملف ZIP ⇒ word/document.xml). */
export async function extractDocxText(buffer) {
  if (!buffer?.length || buffer.length > MAX_PARSE_BYTES) return '';

  try {
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file('word/document.xml') || zip.file('word/document2.xml');
    if (!entry) return '';
    return xmlToText(await entry.async('string')).slice(0, MAX_CHARS_PER_FILE);
  } catch (error) {
    console.warn(`تعذّرت قراءة DOCX: ${error?.code || error?.message}`);
    return '';
  }
}

/** يفكّ ضغط تدفّق PDF (FlateDecode) ويعيده Buffer أو null. */
function inflatePdfStream(chunk) {
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      const out = fn(chunk);
      if (out?.length) return out;
    } catch {
      /* ليس Flate أو تالف */
    }
  }
  return null;
}

/** «00480065» ⇒ [0x48, 0x65] (كل زوج ٤ خانات ست عشرية). */
function hexPairsToCodes(hex) {
  const value = String(hex || '');
  const codes = [];
  for (let i = 0; i + 4 <= value.length; i += 4) codes.push(parseInt(value.slice(i, i + 4), 16));
  return codes.filter((code) => Number.isFinite(code));
}

/** يستخرج كل تدفّقات PDF ويفكّ ضغطها (أو يتركها خام إن لم تكن مضغوطة). */
function pdfStreams(buffer) {
  const latin = buffer.toString('latin1');
  const streams = [];
  let index = latin.indexOf('stream');

  while (index !== -1) {
    // «endstream» تحتوي الكلمة نفسها ⇒ نتخطاها، وإلا ضاعت تدفّقات حقيقية.
    const isReal = latin.slice(Math.max(0, index - 3), index).toLowerCase() !== 'end';
    let cursor = index + 'stream'.length;
    while (cursor < latin.length && latin[cursor] !== '\n' && latin[cursor] !== '\r') cursor += 1;
    if (latin[cursor] === '\r') cursor += 1;
    if (latin[cursor] === '\n') cursor += 1;

    if (!isReal) {
      index = latin.indexOf('stream', index + 6);
      continue;
    }

    // الطريقة الصحيحة: نأخذ الطول من قاموس الكائن (/Length N) إن وُجد —
    // البحث عن «endstream» داخل بيانات ثنائية قد يقطع التدفّق خطأً.
    const dict = latin.slice(Math.max(0, index - 400), index);
    const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let stop = lengthMatch ? cursor + Number(lengthMatch[1]) : -1;

    if (stop < cursor || stop > latin.length) {
      const stopAt = latin.indexOf('endstream', cursor);
      if (stopAt === -1) break;
      stop = stopAt;
      // سطر النهاية قبل endstream ليس جزءاً من البيانات.
      while (stop > cursor && (latin[stop - 1] === '\n' || latin[stop - 1] === '\r')) stop -= 1;
    }

    const chunk = buffer.subarray(cursor, Math.min(stop, latin.length));
    streams.push(inflatePdfStream(chunk) || chunk);
    index = latin.indexOf('stream', cursor + chunk.length);
  }

  return streams;
}

/** خرائط ToUnicode من الملف (bfchar + bfrange) — تُستعمل لفكّ النصوص الهِشّة. */
function pdfCmaps(buffer, streams = []) {
  // خرائط ToUnicode تكون عادة **داخل تدفّق مضغوط**، فالبحث في الملف الخام وحده
  // يفشل ⇒ لا تُفكّ العربية ولا تُقرأ. لذلك نبحث في: الملف الخام + كل التدفّقات المفكوكة.
  const haystacks = [buffer.toString('latin1'), ...streams.map((stream) => stream.toString('latin1'))];
  const maps = [];

  for (const block of haystacks.flatMap((text) => text.match(/beginbfchar[\s\S]*?endbfchar/g) || [])) {
    const map = new Map();
    for (const pair of block.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || []) {
      const parts = pair.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      const codes = parts && hexPairsToCodes(parts[2]);
      if (codes?.length) map.set(parseInt(parts[1], 16), String.fromCodePoint(...codes));
    }
    if (map.size) maps.push(map);
  }

  for (const block of haystacks.flatMap((text) => text.match(/beginbfrange[\s\S]*?endbfrange/g) || [])) {
    const map = new Map();
    for (const triple of block.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || []) {
      const parts = triple.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      if (!parts) continue;
      const from = parseInt(parts[1], 16);
      const to = parseInt(parts[2], 16);
      const start = hexPairsToCodes(parts[3])[0];
      if (start === undefined || to < from || to - from > 65535) continue;
      for (let i = 0; i <= to - from; i += 1) map.set(from + i, String.fromCodePoint(start + i));
    }
    if (map.size) maps.push(map);
  }

  return maps;
}

/** يفكّ نصّاً هِشّاً بخرائط ToUnicode ثم يجرّب UTF-16BE ثم Latin-1. */
function decodeHexString(hex, cmaps) {
  const codes = hexPairsToCodes(hex);
  if (!codes.length) return '';

  // نختار الخريطة التي تفكّ أكبر عدد من المحارف (قد تكون الملف خريطة واحدة
  // لكل الخطوط، فلا نكتف�� بأول نتيجة جزئية).
  let best = '';
  for (const map of cmaps) {
    const decoded = codes.map((code) => map.get(code)).filter(Boolean).join('');
    if (decoded.length > best.length) best = decoded;
    if (best.length === codes.length) break;
  }
  if (best) return best;

  try {
    const asUtf16 = Buffer.from(codes.flatMap((c) => [c >> 8, c & 0xff])).toString('utf16le');
    if (/[\p{L}\p{N}]{2,}/u.test(asUtf16.replace(/[\x00-\x1F]/g, ''))) return asUtf16;
  } catch {
    /* تجاهُل */
  }

  return Buffer.from(codes.map((c) => c & 0xff)).toString('latin1');
}

/** يفكّ النصوص الحرفية مع محارف الهروب. */
function decodeLiteralString(value) {
  return String(value || '').replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, esc) => {
    const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    if (map[esc]) return map[esc];
    if (/^[0-7]{1,3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    return esc;
  });
}

/**
 * استخراج نصّ من PDF (أفضل ما يمكن بلا مكتبات): نقرأ مشغّلات إظهار النصّ
 * (Tj / TJ / ' / ")، ونطبّق خرائط ToUnicode، ونحوّل حركات السطر إلى أسطر.
 * حدّ معروف: PDF الممسوح ضوئياً (صورة) لا يُنتج نصاً أبداً، وبعض الخطوط
 * بلا خريطة ToUnicode تُخرج رموزاً غير مفهومة — وعندها نُبلغ الباحث بوضوح.
 */
/** هل النصّ المستخرج «مفهوم» أم حروف عشوائية من ترميز خط خاطئ؟ */
function looksReadable(text) {
  const value = String(text || '').trim();
  if (value.length < 12) return false;
  const letters = value.replace(/[^\p{L}\p{N}\s.,;:!?()\[\]%-]/gu, '').length;
  return letters / value.length >= 0.7;
}

/** يجمع مقتطفات النصّ من تدفّقات المحتوى (المشغِّل الفعلي في جوهرها). */
function extractPdfTokens(buffer, streams, cmaps) {
  const pieces = [];

  for (const stream of streams) {
    const text = stream.toString('latin1');
    if (!/(Tj|TJ)/.test(text)) continue;

    const tokenPattern =
      /(\((?:\\.|[^\\()])*\))\s*(Tj|'|")|\[((?:[^\][]|\\.)*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*(Tj|TJ)|(\bT[dD*]\b)|(\bET\b)/g;
    let match = tokenPattern.exec(text);

    while (match) {
      if (match[1] !== undefined) {
        pieces.push(decodeLiteralString(match[1].slice(1, -1)));
      } else if (match[3] !== undefined) {
        const partPattern = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
        let part = partPattern.exec(match[3]);
        while (part) {
          if (part[0].startsWith('(')) pieces.push(decodeLiteralString(part[0].slice(1, -1)));
          else if (part[1] !== undefined) pieces.push(decodeHexString(part[1], cmaps));
          else if (Number(part[2]) <= -120) pieces.push(' ');
          part = partPattern.exec(match[3]);
        }
      } else if (match[4] !== undefined) {
        pieces.push(decodeHexString(match[4], cmaps));
      } else if (match[5] || match[6]) {
        pieces.push('\n');
      }
      match = tokenPattern.exec(text);
    }
  }

  return pieces
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractPdfTextFallback(buffer) {
  if (!buffer?.length || buffer.length > MAX_PARSE_BYTES) return '';

  let streams = [];
  let cmaps = [];
  try {
    streams = pdfStreams(buffer);
    cmaps = pdfCmaps(buffer, streams);
  } catch (error) {
    console.warn(`تعذّرت قراءة PDF: ${error?.code || error?.message}`);
    return '';
  }

  const first = extractPdfTokens(buffer, streams, cmaps);
  if (looksReadable(first)) return first.slice(0, MAX_CHARS_PER_FILE);

  // محاولة ثانية بلا خرائط (ملفات بخطوط بسيطة تكتب المحارف مباشرة).
  const second = extractPdfTokens(buffer, streams, []);
  if (looksReadable(second)) return second.slice(0, MAX_CHARS_PER_FILE);

  // نتيجة غير مفهومة (خط خاص بلا ToUnicode) ⇒ نُرجع فراغاً بدل تمرير حروف عشوائية.
  return '';
}


/**
 * المحرك الأساسي: pdf.js (Mozilla) — يقرأ بنية PDF الحقيقية: جداول المراجع
 * المضغوطة (xref streams)، تدفّقات الكائنات (ObjStm)، خطوط CID مع ToUnicode،
 * والخطوط القياسية. هذا ما يجعل ملفات Word/Chrome/LaTeX تُقرأ فعلاً.
 * المستخرِج الخفيف أدناه يبقى كاحتياط لو تعذّر تحميل المحرك.
 */
let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((error) => {
      console.warn(`تعذّر تحميل محرك PDF: ${error?.code || error?.message}`);
      return null;
    });
  }
  return pdfjsPromise;
}

/** أقصى عدد صفحات نقرأها من ملف واحد (حماية من الملفات الضخمة). */
const MAX_PDF_PAGES = 40;

/** استخراج نصّ PDF عبر pdf.js مع تتبّع مواضع النصّ (أسطر meaningful). */
async function extractPdfWithPdfJs(buffer) {
  const pdfjs = await loadPdfJs();
  if (!pdfjs) return '';

  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');

  // ملفات الخطوط القياسية (تُستعمل في ترميز النصوص اللاتينية غير المضمّنة)
  let standardFontDataUrl;
  try {
    const pkg = fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'));
    const dir = path.join(path.dirname(pkg), 'standard_fonts') + path.sep;
    standardFontDataUrl = pathToFileUrl(dir);
  } catch {
    standardFontDataUrl = undefined;
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl
  }).promise;

  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const chunks = [];

  for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    let line = '';

    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      // كسر السطر عند تغيّر الموضع الرأسي في الصفحة
      if (item.hasEOL) {
        chunks.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) chunks.push(line.trim());
  }

  await doc.destroy?.();

  // بعض الملفات تُخرج محارف متباعدة بمحارف NUL (تحويل CID بـ16بت) ⇒ ننظّفها.
  return chunks
    .join('\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .slice(0, MAX_CHARS_PER_FILE);
}

/** file:// من مسار نظام ملفات (لخطوط pdf.js القياسية). */
function pathToFileUrl(dirPath) {
  return new URL(`file://${dirPath}`).toString();
}

/** واجهة واحدة: { text, kind } — وkind للرسالة التي يراها الباحث عند التعذّر. */
export async function extractFileText(buffer, fileName = '') {
  const name = String(fileName || '').toLowerCase();

  if (/\.(txt|md|csv|json)$/.test(name)) {
    return { text: Buffer.from(buffer).toString('utf8').slice(0, MAX_CHARS_PER_FILE), kind: 'text' };
  }
  if (/\.(xlsx|xls)$/.test(name)) {
    const parsed = await readSpreadsheet(buffer, name);
    const text = parsed.sheets
      .map((sheet) => `ورقة «${sheet.name}»:\n${sheet.rows.slice(0, 40).map((row) => row.join('\t')).join('\n')}`)
      .join('\n\n');
    return { text: text.slice(0, MAX_CHARS_PER_FILE), kind: parsed.error ? 'unsupported' : 'sheet' };
  }
  if (/\.docx$/.test(name)) return { text: await extractDocxText(buffer), kind: 'docx' };
  if (/\.pdf$/.test(name)) {
    let text = '';
    try {
      text = await extractPdfWithPdfJs(buffer);
    } catch (error) {
      console.warn(`تعذّر استخراج نصّ PDF بالمحرك الأساسي: ${error?.code || error?.message}`);
    }
    // احتياط: المستخرِج الخفيف (لو كان الملف بسيطاً أو المحرك غير متاح)
    if (!text.trim()) text = extractPdfTextFallback(buffer);
    return { text, kind: 'pdf' };
  }

  return { text: '', kind: 'unsupported' };
}