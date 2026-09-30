import { Readable } from 'node:stream';
import express from 'express';
import { requireAccount } from '../middleware/auth.js';
import { degreeOfUser, resolvePathForDegree, stepOptionsForDegree, stepTitle } from '../services/journey.js';
import { unreadCount } from '../services/notifications.js';
import {
  addCustomReference,
  addLibraryReference,
  createNote,
  deleteNote,
  deleteReference,
  listNotes,
  listUserReferences,
  referenceStatusCounts,
  searchLibraryItems,
  toggleNotePin,
  updateNote,
  updateReferenceStatus
} from '../services/workspace.js';
import {
  allowedTypesLabel,
  deleteFile,
  filesSummary,
  listFiles,
  maxUploadBytes,
  normalizeFile,
  previewKind,
  readOwnedFile,
  saveUpload,
  textPreview
} from '../services/files.js';
import { renderNotice } from '../views/layout.js';
import { renderFileViewerPage, renderFilesPage, renderNotesPage, renderReferencesPage } from '../views/workspace.js';

/**
 * مسارات مساحة عمل الباحث (1E): المراجع والمفكرة والملفات.
 * كل النماذج HTML عادية (POST ثم 303 redirect) — لا JSON ولا سكربت سطري.
 * حماية الرفع: allowlist للامتدادات والأنواع + حد حجم (files.js)، والملف يُقرأ
 * ويُحذف بملكية الجلسة فقط (WHERE user_id = $1 في كل استعلام).
 */
const router = express.Router();

/** رسائل النتيجة بعد التحويل. */
const FLASH = {
  ref_added: { type: 'ok', message: 'أُضيف المرجع إلى قائمتك.' },
  ref_exists: { type: 'error', message: 'هذا المرجع موجود في قائمتك بالفعل.' },
  ref_missing: { type: 'error', message: 'المرجع غير موجود — حدّث الصفحة.' },
  ref_deleted: { type: 'ok', message: 'حُذف المرجع من قائمتك.' },
  ref_status: { type: 'ok', message: 'حُدّثت حالة القراءة.' },
  ref_bad: { type: 'error', message: 'تعذّر تنفيذ المطلوب على المرجع.' },
  note_added: { type: 'ok', message: 'حُفظت الملاحظة.' },
  note_updated: { type: 'ok', message: 'حُفظت تعديلات الملاحظة.' },
  note_deleted: { type: 'ok', message: 'حُذفت الملاحظة.' },
  note_missing: { type: 'error', message: 'الملاحظة غير موجودة — حدّث الصفحة.' },
  note_bad: { type: 'error', message: 'اكتب عنواناً أو نصاً للملاحظة.' },
  file_uploaded: { type: 'ok', message: 'تم رفع الملف وحفظه في مساحتك.' },
  file_deleted: { type: 'ok', message: 'حُذف الملف.' },
  file_missing: { type: 'error', message: 'الملف غير موجود.' },
  file_bad: { type: 'error', message: 'تعذّر رفع الملف — تحقق من النوع والحجم.' }
};

/** تنبيه النتيجة من باراميترات الرابط (?ok= أو ?err=). */
function flashFromQuery(query) {
  return FLASH[String(query.ok || query.err || '')] || null;
}

/** خريطة { step_key: '1. عنوان' } من مسار درجة الباحث لعرض أسماء الخطوات. */
async function stepTitlesForUser(userId) {
  const path = await resolvePathForDegree(await degreeOfUser(userId));
  return Object.fromEntries(path.steps.map((step) => [step.key, `${step.no}. ${step.title}`]));
}

/** صفحة المراجع: بحث في المكتبة + «مراجعي» + نموذج إضافة يدوية. */
router.get('/references', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const query = String(req.query.q || '').trim().slice(0, 120);
    const stepKey = String(req.query.step || '').trim().slice(0, 100);
    const status = String(req.query.status || '').trim();

    const [results, references, counts, stepOptions, stepTitles, unread] = await Promise.all([
      query ? searchLibraryItems({ userId, q: query }) : Promise.resolve([]),
      listUserReferences(userId, { step: stepKey, status }),
      referenceStatusCounts(userId),
      stepOptionsForDegree(await degreeOfUser(userId)),
      stepTitlesForUser(userId),
      unreadCount(userId)
    ]);

    res.type('html').send(
      renderReferencesPage({
        account: req.account,
        unread,
        query,
        results,
        references,
        counts,
        stepKey,
        stepOptions,
        stepTitles,
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المراجع',
      message: 'حدث خطأ أثناء قراءة مراجعك — أعد المحاولة.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/** إضافة مرجع: من المكتبة (library_item_id) أو يدوياً (title). */
router.post('/references', requireAccount, async (req, res) => {
  const body = req.body || {};
  const step = String(body.step || '').trim().slice(0, 100);
  const back = step ? `/references?step=${encodeURIComponent(step)}` : '/references';

  try {
    if (body.library_item_id) {
      await addLibraryReference(req.account.id, String(body.library_item_id), { step });
    } else {
      await addCustomReference(req.account.id, {
        title: body.title,
        authors: body.authors,
        year: body.year,
        source: body.source,
        note: body.note,
        step
      });
    }
    res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}ok=ref_added`);
  } catch (error) {
    const key = error?.code === 'NOT_ADDED' ? 'ref_exists' : error?.code === 'BAD_STEP' ? 'ref_bad' : 'ref_bad';
    res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}err=${key}`);
  }
});

/** تغيير حالة قراءة مرجع. */
router.post('/references/:id/status', requireAccount, async (req, res) => {
  try {
    await updateReferenceStatus(req.account.id, String(req.params.id), String(req.body?.status || 'to_read'));
    res.redirect(303, '/references?ok=ref_status');
  } catch (error) {
    res.redirect(303, `/references?err=${error?.code === 'NOT_FOUND' ? 'ref_missing' : 'ref_bad'}`);
  }
});

/** حذف مرجع من قائمة الباحث. */
router.post('/references/:id/delete', requireAccount, async (req, res) => {
  const deleted = await deleteReference(req.account.id, String(req.params.id));
  res.redirect(303, `/references?${deleted ? 'ok' : 'err'}=${deleted ? 'ref_deleted' : 'ref_missing'}`);
});

/** صفحة المفكرة. */
router.get('/notes', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const query = String(req.query.q || '').trim().slice(0, 120);
    const stepKey = String(req.query.step || '').trim().slice(0, 100);
    const referenceId = String(req.query.ref || '').trim();
    const editingId = String(req.query.edit || '').trim();

    const [notes, stepOptions, stepTitles, unread] = await Promise.all([
      listNotes(userId, { q: query, step: stepKey, referenceId }),
      stepOptionsForDegree(await degreeOfUser(userId)),
      stepTitlesForUser(userId),
      unreadCount(userId)
    ]);

    res.type('html').send(
      renderNotesPage({
        account: req.account,
        unread,
        notes,
        query,
        stepKey,
        referenceId,
        stepOptions,
        stepTitles,
        editingId,
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المفكرة',
      message: 'حدث خطأ أثناء قراءة ملاحظاتك — أعد المحاولة.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/** إنشاء ملاحظة (مع ربطها بمرجع اختياري عند القدوم من صفحة المراجع). */
router.post('/notes', requireAccount, async (req, res) => {
  const body = req.body || {};
  const step = String(body.step || '').trim().slice(0, 100);
  const referenceId = String(body.reference_id || '').trim();
  const back = step ? `/notes?step=${encodeURIComponent(step)}` : '/notes';

  try {
    await createNote(req.account.id, {
      title: body.title,
      body: body.body,
      tags: body.tags,
      pinned: body.pinned === '1',
      step,
      referenceId: /^[0-9a-f-]{36}$/i.test(referenceId) ? referenceId : null
    });
    res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}ok=note_added`);
  } catch {
    res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}err=note_bad`);
  }
});

/** تعديل ملاحظة. */
router.post('/notes/:id', requireAccount, async (req, res) => {
  const body = req.body || {};
  const step = String(body.step || '').trim().slice(0, 100);

  try {
    await updateNote(req.account.id, String(req.params.id), {
      title: body.title,
      body: body.body,
      tags: body.tags,
      pinned: body.pinned === '1',
      step
    });
    res.redirect(303, `/notes?ok=note_updated${step ? `&step=${encodeURIComponent(step)}` : ''}`);
  } catch (error) {
    res.redirect(303, `/notes?err=${error?.code === 'NOT_FOUND' ? 'note_missing' : 'note_bad'}`);
  }
});

/** تثبيت/إلغاء تثبيت ملاحظة. */
router.post('/notes/:id/pin', requireAccount, async (req, res) => {
  const step = String(req.body?.step || '').trim().slice(0, 100);

  try {
    await toggleNotePin(req.account.id, String(req.params.id));
    res.redirect(303, `/notes?ok=note_updated${step ? `&step=${encodeURIComponent(step)}` : ''}`);
  } catch {
    res.redirect(303, '/notes?err=note_missing');
  }
});

/** حذف ملاحظة. */
router.post('/notes/:id/delete', requireAccount, async (req, res) => {
  const deleted = await deleteNote(req.account.id, String(req.params.id));
  res.redirect(303, `/notes?${deleted ? 'ok' : 'err'}=${deleted ? 'note_deleted' : 'note_missing'}`);
});

/** صفحة الملفات. */
router.get('/files', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const stepKey = String(req.query.step || '').trim().slice(0, 100);

    const [files, summary, stepOptions, stepTitles, unread, maxBytes] = await Promise.all([
      listFiles(userId, { step: stepKey }),
      filesSummary(userId),
      stepOptionsForDegree(await degreeOfUser(userId)),
      stepTitlesForUser(userId),
      unreadCount(userId),
      maxUploadBytes()
    ]);

    res.type('html').send(
      renderFilesPage({
        account: req.account,
        unread,
        files,
        summary,
        stepKey,
        stepOptions,
        stepTitles,
        maxMb: Math.round(maxBytes / (1024 * 1024)),
        allowedTypes: allowedTypesLabel(),
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل الملفات',
      message: 'حدث خطأ أثناء قراءة ملفاتك — أعد المحاولة.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/** رفع ملف: نستقبل multipart يدوياً عبر undici formData (بدون مكتبة خارجية). */
router.post('/files', requireAccount, async (req, res) => {
  const step = String(req.query.step || '').trim().slice(0, 100);

  try {
    const request = new Request('http://localhost/files', {
      method: 'POST',
      body: Readable.toWeb(req),
      headers: { 'content-type': req.headers['content-type'] || '' },
      duplex: 'half'
    });
    const form = await request.formData();
    const file = form.get('file');
    const title = form.get('title');
    const formStep = form.get('step');

    if (!(file instanceof File) || !file.size) {
      res.redirect(303, '/files?err=file_bad');
      return;
    }

    await saveUpload(req.account.id, {
      file,
      title: title ? String(title) : '',
      step: formStep ? String(formStep) : step
    });
    res.redirect(303, `/files?ok=file_uploaded${step ? `&step=${encodeURIComponent(step)}` : ''}`);
  } catch (error) {
    console.warn(`فشل رفع الملف: ${error?.code || error?.message}`);
    const key = ['TOO_LARGE', 'BAD_TYPE', 'BAD_MIME', 'BAD_STEP', 'QUOTA_EXCEEDED'].includes(error?.code)
      ? 'file_bad'
      : 'file_missing';
    res.redirect(303, `/files?err=${key}`);
  }
});

/**
 * تحميل/عرض ملف (مملوك للباحث فقط).
 *  - الافتراضي: تحميل (Content-Disposition: attachment).
 *  - ?inline=1 : عرض داخل المتصفح — لنوع «النص» نُجبر text/plain مع nosniff
 *    حتى لا يُفسَّر محتوى مرفوع كـ HTML (منع XSS مخزّن).
 */
router.get('/files/:id/raw', requireAccount, async (req, res) => {
  const found = await readOwnedFile(req.account.id, String(req.params.id));

  if (!found) {
    res.status(404).type('text').send('الملف غير موجود.');
    return;
  }
  if (!found.buffer) {
    res.status(410).type('text').send('ملف البايتات مفقود على القرص — احذفه وارفعه من جديد.');
    return;
  }

  const inline = req.query.inline === '1';
  const kind = previewKind(found.row.file_name, found.row.mime);
  const name = encodeURIComponent(found.row.file_name);
  const safeMime = inline ? safeInlineMime(kind, found.row.mime) : null;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('content-type', safeMime || found.row.mime || 'application/octet-stream');
  res.setHeader('content-length', found.buffer.length);
  res.setHeader('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`);

  // حماية إضافية: نمنع أي محتوى مرفوع من تنفيذ سكربت داخل أصل الموقع
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");

  res.send(found.buffer);
});

/** نوع محتوى آمن للعرض داخل المتصفح حسب نوع الملف. */
function safeInlineMime(kind, mime) {
  if (kind === 'image') {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'application/octet-stream';
  }
  if (kind === 'pdf') return 'application/pdf';
  // النص دائماً text/plain — لا text/html أبداً حتى لو ملف مرفوع يحتوي وسم script
  if (kind === 'text') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** صفحة معاينة ملف: صورة/PDF/نص داخل الموقع. */
router.get('/files/:id/view', requireAccount, async (req, res) => {
  const fileId = String(req.params.id);
  const found = await readOwnedFile(req.account.id, fileId);

  if (!found) {
    const { html } = renderNotice({
      title: 'الملف غير موجود',
      message: 'هذا الملف غير موجود في حسابك — ربما حُذف.',
      extraHtml: '<div class="links"><a class="btn btn-primary" href="/files">ملفاتي</a></div>'
    });
    res.status(404).type('html').send(html);
    return;
  }

  const file = normalizeFile(found.row);
  const kind = previewKind(found.row.file_name, found.row.mime);
  const textContent = kind === 'text' ? textPreview(found.buffer) : null;
  const stepName = file.stepKey ? await stepTitle(file.stepKey) : '';

  res.type('html').send(
    renderFileViewerPage({
      account: req.account,
      unread: await unreadCount(req.account.id),
      file,
      kind,
      textContent,
      stepTitle: stepName || '',
      missing: !found.buffer
    })
  );
});

/** حذف ملف (مملوك للباحث فقط). */
router.post('/files/:id/delete', requireAccount, async (req, res) => {
  const deleted = await deleteFile(req.account.id, String(req.params.id));
  res.redirect(303, `/files?${deleted ? 'ok' : 'err'}=${deleted ? 'file_deleted' : 'file_missing'}`);
});

export { router as workspaceRouter };

