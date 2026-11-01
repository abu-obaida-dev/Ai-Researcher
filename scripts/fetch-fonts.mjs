/**
 * Downloads the brand fonts to public/fonts and generates public/fonts.css.
 * Run once with an internet connection; fonts are then served locally.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FONTS_DIR = path.join(process.cwd(), 'public', 'fonts');
const CSS_FILE = path.join(process.cwd(), 'public', 'fonts.css');

/** Required fonts and character subsets. */
const REQUESTS = [
  {
    css: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap',
    subsets: ['latin', 'latin-ext'],
    fileName: (subset) => `manrope-${subset}.woff2`
  },
  {
    css: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap',
    subsets: ['arabic'],
    fileName: (subset, weight) => `ibm-plex-sans-arabic-${weight}-${subset}.woff2`
  }
];

/** Extracts @font-face blocks and subset labels from Google Fonts CSS. */
const FACE_RE = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;

/** Reads a property from an @font-face block. */
function readProperty(block, property) {
  const match = block.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : '';
}

/** Parses an @font-face block into local font metadata. */
function parseFace(subset, block) {
  const src = block.match(/url\(([^)]+)\)/i);

  return {
    subset,
    family: readProperty(block, 'font-family').replaceAll("'", ''),
    style: readProperty(block, 'font-style') || 'normal',
    weight: readProperty(block, 'font-weight') || '400',
    unicodeRange: readProperty(block, 'unicode-range'),
    url: src ? src[1].trim() : ''
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) {
    throw new Error(`فشل الطلب ${url} — الحالة ${response.status}`);
  }
  return response.text();
}

async function fetchBinary(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) {
    throw new Error(`فشل تنزيل ${url} — الحالة ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Generates local CSS in Google Fonts order. */
function renderCss(faces) {
  const blocks = faces.map(
    (face) => `/* ${face.subset} */
@font-face {
  font-family: '${face.family}';
  font-style: ${face.style};
  font-weight: ${face.weight};
  font-display: swap;
  src: url('/fonts/${face.file}') format('woff2');
  unicode-range: ${face.unicodeRange};
}`
  );

  return `/* === خطوط هوية Zena AI — مولَّد آلياً بـ scripts/fetch-fonts.mjs، لا تعدّله يدوياً === */
${blocks.join('\n\n')}
`;
}

async function main() {
  await mkdir(FONTS_DIR, { recursive: true });

  const faces = [];

  for (const request of REQUESTS) {
    console.log(`قراءة تعريفات الخطوط: ${request.css}`);
    const css = await fetchText(request.css);

    for (const [, subset, block] of css.matchAll(FACE_RE)) {
      if (!request.subsets.includes(subset)) continue;

      const face = parseFace(subset, block);
      face.file = request.fileName(subset, face.weight);

      console.log(`  تنزيل ${face.family} ${face.weight} (${subset}) -> fonts/${face.file}`);
      await writeFile(path.join(FONTS_DIR, face.file), await fetchBinary(face.url));
      faces.push(face);
    }
  }

  await writeFile(CSS_FILE, renderCss(faces), 'utf8');
  console.log(`\nتم: ${faces.length} ملف خط + public/fonts.css`);
}

main().catch((error) => {
  console.error(`\nفشل تنزيل الخطوط: ${error.message}`);
  console.error('الواجهة ستعمل باحتياطي النظام، أو أعد تشغيل الأمر عند توفر الإنترنت.');
  process.exit(1);
});
