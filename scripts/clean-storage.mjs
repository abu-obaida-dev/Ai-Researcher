import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { pool } from '../src/db/client.js';

/**
 * تنظيف ملفات التخزين غير المرتبطة بأي صف في قاعدة البيانات (orphan files).
 *
 * المصدر الوحيد للحقيقة هو قاعدة البيانات:
 *   - storage/library/references/  ← library_items.stored_path
 *   - storage/users/<userId>/      ← files.stored_path
 *
 * أي ملف على القرص غير مذكور في هذه الأعمدة = يتيم (حُذف صفه، أو فشل رفع،
 * أو نسخة قديمة) فيُحذف. الوضع الافتراضي «تجفيف» (dry-run): يطبع فقط،
 * والحذف الفعلي مع --delete.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE = path.join(ROOT, 'storage');
const DRY_RUN = !process.argv.includes('--delete');

dotenv.config();

/** كل المسارات المذكورة في قاعدة البيانات (نسبية داخل storage). */
async function referencedPaths() {
  const keep = new Set();

  const [library, files] = await Promise.all([
    pool.query('SELECT stored_path FROM library_items WHERE stored_path IS NOT NULL'),
    pool.query('SELECT stored_path FROM files WHERE stored_path IS NOT NULL')
  ]);

  for (const row of [...library.rows, ...files.rows]) {
    if (row.stored_path) keep.add(path.normalize(String(row.stored_path)));
  }

  return keep;
}

/** كل ملفات مجلد على القرص بمسارات نسبية. */
async function filesOnDisk(dir, prefix = '') {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    // الملفات المخفية وملف README توثيقي: لا تُحذف أبداً
    if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'readme.md') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await filesOnDisk(absolute, path.join(prefix, entry.name))));
    } else {
      out.push(path.join(prefix, entry.name));
    }
  }

  return out;
}

/** حذف المجلدات الفارغة (بعد التنظيف) مع إبقاء جذر storage. */
async function pruneEmptyDirs(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    await pruneEmptyDirs(child);
    const left = await readdir(child);
    if (!left.length && dir !== STORAGE) await rmdir(child).catch(() => {});
  }
}

async function main() {
  const keep = await referencedPaths();
  const onDisk = await filesOnDisk(STORAGE);

  const orphans = onDisk.filter((relative) => !keep.has(path.normalize(relative)));
  const missing = [...keep].filter((relative) => !onDisk.some((item) => path.normalize(item) === relative));

  let freed = 0;
  for (const relative of orphans) {
    const absolute = path.join(STORAGE, relative);
    const info = await stat(absolute).catch(() => null);
    freed += info?.size || 0;
    if (!DRY_RUN) {
      await unlink(absolute).catch(() => {});
      console.log(`deleted     ${relative}`);
    } else {
      console.log(`would-delete ${relative}`);
    }
  }

  if (!DRY_RUN) await pruneEmptyDirs(STORAGE);

  const mb = (freed / (1024 * 1024)).toFixed(2);
  console.log(
    `\n${DRY_RUN ? 'فحص' : 'تنظيف'}: ${orphans.length} ملف يتيم (${mb} MB) · ` +
      `${keep.size} ملف مرتبط بقاعدة البيانات · ${missing.length} مرفق مفقود على القرص`
  );
  if (DRY_RUN && orphans.length) console.log('للتنفيذ فعلياً: npm run storage:clean -- --delete');

  await pool.end();
}

main().catch(async (error) => {
  console.error('تعذّر تنظيف التخزين:', error.message);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});