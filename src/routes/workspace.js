import { Readable } from 'node:stream';
import express from 'express';
import { needsOnboarding, requireAccount, requireService } from '../middleware/auth.js';
import { concurrencyLimit, rateLimitUser } from '../middleware/security.js';
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
  normalizeFile,
  previewKind,
  readOwnedFile,
  saveUpload,
  textPreview,
  userFileMaxBytes
} from '../services/files.js';
import { renderNotice } from '../views/layout.js';
import { renderFileViewerPage, renderFilesPage, renderLibraryPage, renderNotesPage } from '../views/workspace.js';
import { readSpreadsheet, spreadsheetErrorMessage } from '../services/spreadsheet.js';
import { readLibraryItem } from '../services/library.js';
import { LIBRARY_SOURCES, normalizeYearRange } from '../services/library-sources.js';
import { searchLiterature, buildSearchQuery } from '../services/literature.js';

/** Research workspace routes for references, notes, and files. */
const router = express.Router();

/** Limits repeated requests to database-heavy workspace pages. */
const pageReadLimit = rateLimitUser('page_read', { limit: 120, windowMs: 5 * 60 * 1000 });

/** Flash messages shown after redirects. */
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
  file_bad: { type: 'error', message: 'تعذّر رفع الملف — تحقق من النوع والحجم.' },
  // Upload errors are customized with account-specific limits when available.
  file_too_large: { type: 'error', message: 'حجم الملف أكبر من الحد المسموح لباقتك.' },
  file_type_bad: { type: 'error', message: 'نوع الملف غير مدعوم — الأنواع المسموحة فقط.' },
  file_mime: { type: 'error', message: 'نوع محتوى الملف لا يطابق امتداده — قد يكون الامتداد قد عُدِّل.' },
  file_quota: { type: 'error', message: 'مساحة باقتك لا تتسع لهذا الملف — احذف ملفات أو احجز مساحة أكبر.' },
  file_step_bad: { type: 'error', message: 'هذه الخطوة غير موجودة في مسار بحثك.' },
  file_no_storage: {
    type: 'error',
    message: 'رفع الملفات غير متاح على هذه المنصة حالياً (نظام الملفات مؤقّت) — بقية المنصة تعمل كما هي.'
  }
};

/** Resolves redirect messages and adds account-specific upload details. */
function flashFromQuery(query, ctx = {}) {
  const entry = FLASH[String(query.ok || query.err || '')];
  if (!entry) return null;
  const key = String(query.ok || query.err || '');
  const dynamic = {
    file_too_large: `حجم الملف أكبر من الحد المسموح: حتى ${Number(ctx.maxMb || 0)} MB للملف الواحد في باقتك.`,
    file_type_bad: `نوع الملف غير مدعوم — الأنواع المسموحة فقط: ${ctx.allowedTypes || ''}.`,
    file_quota: `مساحة باقتك لا تتسع لهذا الملف: المستخدم ${ctx.summary?.usedLabel || '0'} من ${
      ctx.summary?.quotaLabel || '0'
    } — احذف ملفاً أو احجز مساحة أكبر.`,
    file_mime: 'نوع محتوى الملف لا يطابق امتداده — قد يكون الامتداد قد عُدِّل.'
  };
  return { type: entry.type, message: dynamic[key] || entry.message };
}

/** Maps stable step keys to display labels. */
async function stepTitlesForUser(userId) {
  const path = await resolvePathForDegree(await degreeOfUser(userId));
  return Object.fromEntries(path.steps.map((step) => [step.key, `${step.no}. ${step.title}`]));
}

/** Redirects the legacy references page to the combined files page. */
router.get('/references', (req, res) => {
  const qs = String(req.originalUrl || '').split('?')[1];
  res.redirect(303, `/files${qs ? `?${qs}` : ''}`);
});

/** Renders platform-library results and optional external literature search results. */
router.get('/library', pageReadLimit, requireService('library'), async (req, res) => {
  try {
    const userId = req.account.id;
    const query = String(req.query.q || '').trim().slice(0, 120);
    const stepKey = String(req.query.step || '').trim().slice(0, 100);
    const webQuery = String(req.query.wq || '').trim().slice(0, 160);
    const requestedSource = String(req.query.wsrc || '').trim().slice(0, 30);
    const webSource = LIBRARY_SOURCES.some((source) => source.id === requestedSource) ? requestedSource : '';
    // Normalize the external-search year range.
    const years = normalizeYearRange(req.query.wfrom, req.query.wto);

    const [results, unread, web] = await Promise.all([
      query ? searchLibraryItems({ userId, q: query }) : Promise.resolve([]),
      unreadCount(userId),
      // External searches are requested through the library page only.
      webQuery
        ? searchLiterature({
            query: buildSearchQuery({ topic: webQuery }),
          sources: webSource ? [webSource] : LIBRARY_SOURCES.map((source) => source.id),
          allSources: !webSource,
            limit: 25,
            topic: webQuery,
            yearFrom: years.from,
            yearTo: years.to
          })
        : Promise.resolve(null)
    ]);

    res.type('html').send(
      renderLibraryPage({
        account: req.account,
        unread,
        query,
        results,
        stepKey,
        web,
        webQuery,
        webSource,
        webYearFrom: years.from,
        webYearTo: years.to,
        webSources: LIBRARY_SOURCES,
        flash: flashFromQuery(req.query),
        // Profile-based recommendations require a completed research profile.
        profileNotice: needsOnboarding(req.account)
          ? 'أضف تخصصك ومرحلتك الأكاديمية وهدفك الحالي ليرشّح لك المشرف الذكي المراجع الأقرب لموضوعك. <a href="/onboarding?next=/library">أكمل ملفك الآن</a>.'
          : ''
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المكتبة',
      message: 'حدث خطأ أثناء فتح المكتبة — أعد المحاولة.',
      details: error?.message || '',
      area: 'app',
      activeKey: 'library'
    });
    res.status(500).type('html').send(html);
  }
});

/** Serves an active library file inline or as an attachment. */
router.get('/library/:id/file', requireService('library'), async (req, res) => {
  try {
    const found = await readLibraryItem(String(req.params.id), { activeOnly: true });
    if (!found) {
      res.status(404).type('text').send('الكتاب غير موجود في مكتبة المنصة.');
      return;
    }
    if (!found.buffer) {
      const link = found.row.external_url;
      res
        .status(410)
        .type('html')
        .send(
          `<p style="font-family:sans-serif">لا يتوفّر ملف لهذا العنصر في المكتبة.${
            link ? ` <a href="${escapeAttr(link)}" target="_blank" rel="noopener">افتح المصدر الأصلي ↗</a>` : ''
          }</p>`
        );
      return;
    }

    const inline = String(req.query.inline || '') === '1';
    const row = found.row;
    const isText = String(row.mime || '').startsWith('text/') || /\.(txt|md|csv)$/i.test(row.file_name || '');
    const name = encodeURIComponent(row.file_name || `${row.title || 'book'}.pdf`);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('content-length', found.buffer.length);

    if (inline && !isText) {
      res.setHeader('content-type', row.mime || 'application/octet-stream');
      res.setHeader('content-disposition', `inline; filename*=UTF-8''${name}`);
    } else {
      // Serve text as plain text to prevent uploaded HTML from executing.
      res.setHeader('content-type', isText ? 'text/plain; charset=utf-8' : row.mime || 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${name}`);
    }

    res.send(found.buffer);
  } catch (error) {
    console.warn(`تعذّر فتح ملف مكتبة: ${error?.code || error?.message}`);
    res.status(500).type('text').send('تعذّر قراءة الملف.');
  }
});

/** Escapes a value for an HTML attribute. */
function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Adds an external search result to the user's references.
 */
router.post(
  '/references/web',
  requireService('library'),
  rateLimitUser('reference_web_add', { limit: 30, windowMs: 10 * 60 * 1000 }),
  async (req, res) => {
    const body = req.body || {};
    const step = String(body.step || '').trim().slice(0, 100);
    const back = `/files${step ? `?step=${encodeURIComponent(step)}` : ''}`;

    try {
      await addCustomReference(req.account.id, {
        title: body.title,
        authors: body.authors,
        year: body.year,
        source: [body.venue || body.source, body.doi ? `doi:${body.doi}` : '', body.url || '']
          .filter(Boolean)
          .join(' · ')
          .slice(0, 500),
        note: String(body.note || '').slice(0, 500),
        step
      });
      res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}ok=ref_added`);
    } catch (error) {
      const key = error?.code === 'NOT_ADDED' ? 'ref_exists' : 'ref_bad';
      res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}err=${key}`);
    }
  }
);

/** Adds a platform-library item to the user's references. */
router.post('/references', requireService('library'), async (req, res) => {
  const body = req.body || {};
  const step = String(body.step || '').trim().slice(0, 100);
  const back = step ? `/files?step=${encodeURIComponent(step)}` : '/files';

  try {
    if (!body.library_item_id) {
      res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}err=ref_bad`);
      return;
    }
    await addLibraryReference(req.account.id, String(body.library_item_id), { step });
    res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}ok=ref_added`);
  } catch (error) {
    const key = error?.code === 'NOT_ADDED' ? 'ref_exists' : error?.code === 'BAD_STEP' ? 'ref_bad' : 'ref_bad';
    res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}err=${key}`);
  }
});

/** Updates a reference's reading status. */
router.post('/references/:id/status', requireService('library'), async (req, res) => {
  try {
    await updateReferenceStatus(req.account.id, String(req.params.id), String(req.body?.status || 'to_read'));
    res.redirect(303, '/files?ok=ref_status');
  } catch (error) {
    res.redirect(303, `/files?err=${error?.code === 'NOT_FOUND' ? 'ref_missing' : 'ref_bad'}`);
  }
});

/** Removes a reference from the user's list. */
router.post('/references/:id/delete', requireService('library'), async (req, res) => {
  const deleted = await deleteReference(req.account.id, String(req.params.id));
  res.redirect(303, `/files?${deleted ? 'ok' : 'err'}=${deleted ? 'ref_deleted' : 'ref_missing'}`);
});

/** Renders the notes page. */
router.get('/notes', pageReadLimit, requireService('notes'), async (req, res) => {
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
      details: error?.message || '',
      area: 'app',
      activeKey: 'notes'
    });
    res.status(500).type('html').send(html);
  }
});

/** Creates a note with an optional reference link. */
router.post('/notes', requireService('notes'), async (req, res) => {
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

/** Updates a note. */
router.post('/notes/:id', requireService('notes'), async (req, res) => {
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

/** Toggles a note's pinned state. */
router.post('/notes/:id/pin', requireService('notes'), async (req, res) => {
  const step = String(req.body?.step || '').trim().slice(0, 100);

  try {
    await toggleNotePin(req.account.id, String(req.params.id));
    res.redirect(303, `/notes?ok=note_updated${step ? `&step=${encodeURIComponent(step)}` : ''}`);
  } catch {
    res.redirect(303, '/notes?err=note_missing');
  }
});

/** Deletes a note. */
router.post('/notes/:id/delete', requireService('notes'), async (req, res) => {
  const deleted = await deleteNote(req.account.id, String(req.params.id));
  res.redirect(303, `/notes?${deleted ? 'ok' : 'err'}=${deleted ? 'note_deleted' : 'note_missing'}`);
});

/** Renders the combined files and references page. */
router.get('/files', pageReadLimit, requireService('files'), async (req, res) => {
  try {
    const userId = req.account.id;
    const stepKey = String(req.query.step || '').trim().slice(0, 100);
    const status = String(req.query.status || '').trim();

    const [files, summary, references, refCounts, stepOptions, stepTitles, unread, maxBytes] = await Promise.all([
      listFiles(userId, { step: stepKey }),
      filesSummary(userId),
      listUserReferences(userId, { step: stepKey, status }),
      referenceStatusCounts(userId),
      stepOptionsForDegree(await degreeOfUser(userId)),
      stepTitlesForUser(userId),
      unreadCount(userId),
      userFileMaxBytes(userId)
    ]);

    const maxMb = Math.round(maxBytes / (1024 * 1024));

    res.type('html').send(
      renderFilesPage({
        account: req.account,
        unread,
        files,
        summary,
        references,
        refCounts,
        stepKey,
        stepOptions,
        stepTitles,
        maxMb,
        allowedTypes: allowedTypesLabel(),
        flash: flashFromQuery(req.query, { maxMb, allowedTypes: allowedTypesLabel(), summary })
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل الملفات',
      message: 'حدث خطأ أثناء قراءة ملفاتك — أعد المحاولة.',
      details: error?.message || '',
      area: 'app',
      activeKey: 'files'
    });
    res.status(500).type('html').send(html);
  }
});

/** Parses multipart uploads with the built-in FormData API. */
router.post(
  '/files',
  requireService('files'),
  rateLimitUser('file_upload', { limit: 20, windowMs: 10 * 60 * 1000 }),
  concurrencyLimit('uploads'),
  async (req, res) => {
  const step = String(req.query.step || '').trim().slice(0, 100);

  try {
    // Reject oversized requests before buffering the multipart body.
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > 0) {
      const maxBytes = await userFileMaxBytes(req.account.id);
      if (declared > maxBytes + 2 * 1024 * 1024) {
        console.warn(`رُفض رفع ضخم بلا قراءة: ${declared} بايت`);
        res.redirect(303, '/files?err=file_too_large');
        return;
      }
    }

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
    // Return a specific flash message for each upload rejection.
    const CODE_TO_KEY = {
      TOO_LARGE: 'file_too_large',
      BAD_TYPE: 'file_type_bad',
      BAD_MIME: 'file_mime',
      QUOTA_EXCEEDED: 'file_quota',
      BAD_STEP: 'file_step_bad',
      BAD_CONTENT: 'file_bad',
      NO_STORAGE: 'file_no_storage'
    };
    const key = CODE_TO_KEY[error?.code] || 'file_missing';
    res.redirect(303, `/files?err=${key}`);
  }
  }
);

/** Serves an owned file as a download or safe inline preview. */
router.get('/files/:id/raw', requireService('files'), async (req, res) => {
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

  // Prevent uploaded content from executing scripts on the application origin.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");

  res.send(found.buffer);
});

/** Returns a safe inline content type for the file. */
function safeInlineMime(kind, mime) {
  if (kind === 'image') {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'application/octet-stream';
  }
  if (kind === 'pdf') return 'application/pdf';
  // Always serve text as text/plain, even if it contains script tags.
  if (kind === 'text') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** Renders an image, PDF, or text file preview. */
router.get('/files/:id/view', requireService('files'), async (req, res) => {
  const fileId = String(req.params.id);
  const found = await readOwnedFile(req.account.id, fileId);

  if (!found) {
    const { html } = renderNotice({
      title: 'الملف غير موجود',
      message: 'هذا الملف غير موجود في حسابك — ربما حُذف.',
      extraHtml: '<div class="links"><a class="btn btn-primary" href="/files">ملفاتي</a></div>',
      area: 'app',
      activeKey: 'files'
    });
    res.status(404).type('html').send(html);
    return;
  }

  const file = normalizeFile(found.row);
  const kind = previewKind(found.row.file_name, found.row.mime);
  const textContent = kind === 'text' ? textPreview(found.buffer) : null;

  // Parse spreadsheet data on the server and render escaped HTML.
  let sheetData = null;
  let sheetError = '';
  if (kind === 'sheet' && found.buffer) {
    const parsed = await readSpreadsheet(found.buffer, found.row.file_name);
    sheetData = parsed.sheets.length ? parsed : null;
    if (!sheetData) sheetError = spreadsheetErrorMessage(parsed.error);
  }

  const stepName = file.stepKey ? await stepTitle(file.stepKey) : '';

  res.type('html').send(
    renderFileViewerPage({
      account: req.account,
      unread: await unreadCount(req.account.id),
      file,
      kind,
      textContent,
      sheetData,
      sheetError,
      stepTitle: stepName || '',
      missing: !found.buffer
    })
  );
});

/** Deletes an owned file. */
router.post('/files/:id/delete', requireService('files'), async (req, res) => {
  const deleted = await deleteFile(req.account.id, String(req.params.id));
  res.redirect(303, `/files?${deleted ? 'ok' : 'err'}=${deleted ? 'file_deleted' : 'file_missing'}`);
});

export { router as workspaceRouter };

