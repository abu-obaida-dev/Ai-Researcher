import { inflateSync, inflateRawSync } from 'node:zlib';
import JSZip from 'jszip';
import { readSpreadsheet } from './spreadsheet.js';

/** Extracts text from supported user uploads for model context. */

/** Maximum injected text length per file. */
const MAX_CHARS_PER_FILE = 120000;

/** Maximum file size accepted by text extraction. */
const MAX_PARSE_BYTES = 20 * 1024 * 1024;

/** Decodes common XML entities. */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32))
    .replace(/&amp;/g, '&');
}

/** Converts Word XML to text while preserving paragraph boundaries. */
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

/** Extracts document.xml from a DOCX archive. */
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

/** Inflates a PDF FlateDecode stream. */
function inflatePdfStream(chunk) {
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      const out = fn(chunk);
      if (out?.length) return out;
    } catch {
      /* Unsupported or corrupt stream. */
    }
  }
  return null;
}

/** Decodes four-hex-digit UTF-16 code units. */
function hexPairsToCodes(hex) {
  const value = String(hex || '');
  const codes = [];
  for (let i = 0; i + 4 <= value.length; i += 4) codes.push(parseInt(value.slice(i, i + 4), 16));
  return codes.filter((code) => Number.isFinite(code));
}

/** Extracts PDF streams and inflates compressed streams. */
function pdfStreams(buffer) {
  const latin = buffer.toString('latin1');
  const streams = [];
  let index = latin.indexOf('stream');

  while (index !== -1) {
    // Skip the endstream token itself.
    const isReal = latin.slice(Math.max(0, index - 3), index).toLowerCase() !== 'end';
    let cursor = index + 'stream'.length;
    while (cursor < latin.length && latin[cursor] !== '\n' && latin[cursor] !== '\r') cursor += 1;
    if (latin[cursor] === '\r') cursor += 1;
    if (latin[cursor] === '\n') cursor += 1;

    if (!isReal) {
      index = latin.indexOf('stream', index + 6);
      continue;
    }

    // Prefer the declared stream length; binary data may contain the endstream token.
    const dict = latin.slice(Math.max(0, index - 400), index);
    const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let stop = lengthMatch ? cursor + Number(lengthMatch[1]) : -1;

    if (stop < cursor || stop > latin.length) {
      const stopAt = latin.indexOf('endstream', cursor);
      if (stopAt === -1) break;
      stop = stopAt;
      // Exclude the line break before endstream from the payload.
      while (stop > cursor && (latin[stop - 1] === '\n' || latin[stop - 1] === '\r')) stop -= 1;
    }

    const chunk = buffer.subarray(cursor, Math.min(stop, latin.length));
    streams.push(inflatePdfStream(chunk) || chunk);
    index = latin.indexOf('stream', cursor + chunk.length);
  }

  return streams;
}

/** Reads ToUnicode mappings used by PDF text extraction. */
function pdfCmaps(buffer, streams = []) {
  // ToUnicode maps are often compressed, so inspect both raw and inflated streams.
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

/** Decodes PDF text using font maps, then UTF-16BE and Latin-1 fallbacks. */
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
    /* Ignore malformed mapping entries. */
  }

  return Buffer.from(codes.map((c) => c & 0xff)).toString('latin1');
}

/** Decodes escaped PDF literal strings. */
function decodeLiteralString(value) {
  return String(value || '').replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, esc) => {
    const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    if (map[esc]) return map[esc];
    if (/^[0-7]{1,3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    return esc;
  });
}

/** Extracts text operators from PDFs; scanned pages and unmapped fonts may yield no text. */
/** Rejects extracted text that appears to be garbled. */
function looksReadable(text) {
  const value = String(text || '').trim();
  if (value.length < 12) return false;
  const letters = value.replace(/[^\p{L}\p{N}\s.,;:!?()\[\]%-]/gu, '').length;
  return letters / value.length >= 0.7;
}

/** Collects text fragments from PDF content streams. */
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

  // Retry without font maps for simple fonts that encode characters directly.
  const second = extractPdfTokens(buffer, streams, []);
  if (looksReadable(second)) return second.slice(0, MAX_CHARS_PER_FILE);

  // Return empty text rather than passing garbled characters to the model.
  return '';
}


/** Uses pdf.js for full PDF parsing, with the lightweight parser as fallback. */
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

/** Maximum PDF pages to extract. */
const MAX_PDF_PAGES = 40;

/** Extracts positioned text items from a PDF using pdf.js. */
async function extractPdfWithPdfJs(buffer) {
  const pdfjs = await loadPdfJs();
  if (!pdfjs) return '';

  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');

  // Locate standard fonts used for non-embedded Latin glyphs.
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
      // Start a new line when the vertical position changes.
      if (item.hasEOL) {
        chunks.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) chunks.push(line.trim());
  }

  await doc.destroy?.();

  // Remove NUL separators emitted by some 16-bit CID encodings.
  return chunks
    .join('\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .slice(0, MAX_CHARS_PER_FILE);
}

/** Converts a filesystem path to a file URL for pdf.js standard fonts. */
function pathToFileUrl(dirPath) {
  return new URL(`file://${dirPath}`).toString();
}

/** Returns extracted text and a user-facing failure category. */
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
    // Fall back to the lightweight parser when pdf.js is unavailable.
    if (!text.trim()) text = extractPdfTextFallback(buffer);
    return { text, kind: 'pdf' };
  }

  return { text: '', kind: 'unsupported' };
}