/**
 * تنزيل خطوط هوية Zena AI من Google Fonts إلى public/fonts وتوليد public/fonts.css.
 *
 * الهدف: أن تعمل الواجهة بخطوط الهوية الرسمية دون أي طلب خارجي (لا CDN ولا مخاوف CSP،
 * وتعمل كذلك على جهاز بدون إنترنت).
 *
 * الخطوط المستخدمة حسب «Zena AI — الهوية البصرية»:
 * - Manrope (400..800) للحروف اللاتينية وواجهة المنتج — نكتفي بمجموعتي latin وlatin-ext.
 * - IBM Plex Sans Arabic (400/500/600/700) للنص العربي — نكتفي بمجموعة arabic،
 *   والحروف اللاتينية تأتي من Manrope لأنها أول خط في سلسلة font-family.
 *
 * الترخيص: الخطّان تحت رخصة SIL Open Font License 1.1 ويُسمح باستضافتهما محلياً.
 *
 * الاستخدام: node scripts/fetch-fonts.mjs   (يحتاج اتصال إنترنت مرة واحدة فقط)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FONTS_DIR = path.join(process.cwd(), 'public', 'fonts');
const CSS_FILE = path.join(process.cwd(), 'public', 'fonts.css');

/** الخطوط المطلوبة ومجموعات الحروف التي نحتاجها من كل خط. */
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

/** يفصل ملف Google Fonts إلى كتل @font-face مع اسم مجموعة الحروف في التعليق. */
const FACE_RE = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;

/** يقرأ قيمة خاصية واحدة من كتلة @font-face. */
function readProperty(block, property) {
  const match = block.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : '';
}

/** يحوّل كتلة @font-face إلى بيانات قابلة للتحويل لملف محلي. */
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

/** يولّد ملف CSS واحداً بنفس ترتيب Google Fonts مع روابط محلية. */
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
