/** Validates upload signatures as defense in depth; browser-provided metadata is untrusted. */

/** OLE2 signature used by legacy Office files. */
const OLE2 = [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]];

/** ZIP signatures used by modern Office files and EPUB. */
const ZIP = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08]
];

/** Expected signatures for allowed extensions. */
const SIGNATURES = {
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  webp: [], // يُفحص specially (RIFF....WEBP) لأن التوقيع غير متجاور
  doc: OLE2,
  xls: OLE2,
  ppt: OLE2,
  zip: ZIP,
  docx: ZIP,
  xlsx: ZIP,
  pptx: ZIP,
  epub: ZIP
};

/** Text files must not contain NUL bytes or excessive control characters. */
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);

/** Expected internal ZIP entries for Office document formats. */
const ZIP_FAMILY_MARKER = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' };

/** Number of leading bytes scanned for the expected ZIP entry. */
const ZIP_MARKER_SCAN_BYTES = 2 * 1024 * 1024;

/** Checks whether a buffer begins with a signature. */
function startsWith(buffer, signature) {
  if (!buffer || buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

/** Creates a standardized content-rejection error. */
function reject(reason) {
  const error = new Error('محتوى الملف لا يطابق امتداده — تم الرفض.');
  error.code = 'BAD_CONTENT';
  error.reason = reason;
  return error;
}

/** WebP signature: RIFF header followed by WEBP. */
function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

/** Allows HTML-like text because previews escape it and force text/plain with nosniff. */
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;

  let control = 0;
  for (const byte of sample) {
    // Allow standard whitespace; reject other control characters.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  if (sample.length && control / sample.length > 0.05) return false;

  return true;
}

/** Throws BAD_CONTENT when file bytes do not match the claimed extension. */
export function assertContentMatchesExtension(extension, buffer) {
  if (!buffer?.length) throw reject('empty');

  const ext = String(extension || '').toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    if (!looksLikeText(buffer)) throw reject('text-binary');
    return;
  }

  if (ext === 'webp') {
    if (!isWebp(buffer)) throw reject('webp');
    return;
  }

  const signatures = SIGNATURES[ext];
  // Leave unsupported signatures to the relevant downstream validator.
  if (!signatures) return;

  if (!signatures.some((signature) => startsWith(buffer, signature))) {
    throw reject('signature');
  }

  // Modern Office files must contain the expected ZIP entry.
  const marker = ZIP_FAMILY_MARKER[ext];
  if (marker && buffer.length > 4) {
    const scan = buffer.subarray(0, Math.min(buffer.length, ZIP_MARKER_SCAN_BYTES));
    if (!scan.includes(marker, 0, 'latin1')) {
      throw reject('zip-family');
    }
  }
}

/** Non-throwing wrapper for tests and diagnostics. */
export function contentMatchesExtension(extension, buffer) {
  try {
    assertContentMatchesExtension(extension, buffer);
    return true;
  } catch {
    return false;
  }
}