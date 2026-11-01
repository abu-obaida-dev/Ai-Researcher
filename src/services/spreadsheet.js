import ExcelJS from 'exceljs';

/** Bounded XLSX and CSV parsing for in-app previews. */

/** Maximum sheets per workbook. */
const MAX_SHEETS = 6;
/** Maximum rows per sheet. */
const MAX_ROWS = 200;
/** Maximum columns per row. */
const MAX_COLS = 30;
/** Maximum text length per cell. */
const MAX_CELL = 120;
/** Maximum spreadsheet size accepted for parsing. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Converts a cell value to bounded readable text. */
function cellText(value) {
  if (value === null || value === undefined) return '';

  let text;
  if (value instanceof Date) {
    text = value.toISOString().slice(0, 10);
  } else if (typeof value === 'object') {
    // richText / hyperlink / formula objects
    if (Array.isArray(value.richText)) text = value.richText.map((part) => part.text || '').join('');
    else if (value.text !== undefined) text = String(value.text);
    else if (value.result !== undefined) text = String(value.result);
    else if (value.hyperlink) text = String(value.hyperlink);
    else text = '';
  } else {
    text = String(value);
  }

  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text;
}

/** Parses standard CSV delimiters, quoted fields, and line breaks. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field.trim()); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }

  if (field || row.length) {
    row.push(field.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);
  }

  return rows;
}

/**
 * Parses a spreadsheet and returns its sheets or a typed error:
 * { sheets: [{ name, rows: [[...]], truncated }], truncated, error }
 * error = 'too_large' | 'xls_unsupported' | 'corrupt' عند التعذّر.
 */
export async function readSpreadsheet(buffer, fileName = '') {
  if (!buffer || buffer.length === 0) return { sheets: [], truncated: false, error: 'corrupt' };
  if (buffer.length > MAX_BYTES) return { sheets: [], truncated: false, error: 'too_large' };

  const isCsv = /\.csv$/i.test(fileName);

  if (isCsv) {
    const rows = parseCsv(buffer.toString('utf8'));
    return {
      sheets: [
        {
          name: fileName.replace(/\.csv$/i, '') || 'CSV',
          rows: rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLS)),
          truncated: rows.length > MAX_ROWS
        }
      ],
      truncated: rows.length > MAX_ROWS
    };
  }

  if (/\.xls$/i.test(fileName)) {
    return { sheets: [], truncated: false, error: 'xls_unsupported' };
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheets = workbook.worksheets.slice(0, MAX_SHEETS).map((sheet) => {
      const rows = [];
      let truncated = false;

      sheet.eachRow({ includeEmpty: false }, (row) => {
        if (rows.length >= MAX_ROWS) { truncated = true; return; }
        const values = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          if (col > MAX_COLS) return;
          values[col - 1] = cellText(cell.value);
        });
        // Trim empty trailing columns.
        while (values.length && values[values.length - 1] === '') values.pop();
        if (values.length) rows.push(values);
      });

      return { name: sheet.name || 'ورقة', rows, truncated };
    });

    return { sheets, truncated: sheets.length < workbook.worksheets.length };
  } catch (error) {
    console.warn(`تعذّرت قراءة الجدول ${fileName}: ${error.code || error.message}`);
    return { sheets: [], truncated: false, error: 'corrupt' };
  }
}

/** Maps spreadsheet errors to user-facing messages. */
export function spreadsheetErrorMessage(error) {
  if (error === 'too_large') return 'حجم الملف كبير جداً على المعاينة (الحد 10 ميجابايت) — حمّله وافتحه في Excel.';
  if (error === 'xls_unsupported') return 'صيغة xls القديمة غير مدعومة في المعاينة — احفظ الملف بصيغة xlsx أو csv ثم ارفعه.';
  if (error === 'corrupt') return 'تعذّرت قراءة الملف — قد يكون تالفاً أو محمياً بكلمة مرور. حمّله وافتحه في Excel.';
  return 'لا يمكن عرض هذا الملف هنا — حمّله وافتحه في برنامجه.';
}
