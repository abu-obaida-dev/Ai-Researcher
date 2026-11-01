import { formatFileSize } from '../services/files.js';
import { FILE_UPLOAD_LIMITS, READING_STATUSES } from '../constants.js';
import { SOURCE_GROUPS, sourceGroup } from '../services/library-sources.js';
import { formatDate, formatDateTime, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/** Server-rendered views for references, notes, files, and the library. */

/** Renders the step selector for linking an item. */
function stepSelect(stepOptions, current = '', name = 'step', id = 'step') {
  const options = stepOptions
    .map(
      (item) =>
        `<option value="${escapeHtml(item.value)}"${item.value === current ? ' selected' : ''}>${escapeHtml(
          item.label
        )}</option>`
    )
    .join('');

  return `<div class="field">
  <label for="${escapeHtml(id)}">ربط بخطوة من المسار</label>
  <select id="${escapeHtml(id)}" name="${escapeHtml(name)}">
    <option value="">بدون ربط</option>
    ${options}
  </select>
</div>`;
}

/** Renders a redirect flash message. */
function flashBox(flash) {
  if (!flash?.message) return '';
  return flash.type === 'error' ? `<div class="alert">${escapeHtml(flash.message)}</div>` : `<div class="notice">${escapeHtml(flash.message)}</div>`;
}

/** Checks whether a service is available to the account. */
function serviceOpen(account, key) {
  const services = account?.services;
  if (!Array.isArray(services)) return true;
  return services.some((item) => (typeof item === 'string' ? item === key : item?.key === key && item?.enabled !== false));
}

/** Renders a reference row with reading status and linked notes. */
function renderReferenceRow(reference) {
  const statusOptions = READING_STATUSES.map(
    (item) =>
      `<option value="${escapeHtml(item.value)}"${item.value === reference.status ? ' selected' : ''}>${escapeHtml(
        item.label
      )}</option>`
  ).join('');

  return `<tr>
  <td data-label="المرجع">
    <b class="ref-title" title="${escapeHtml(reference.title)}">${escapeHtml(reference.title)}</b>
    <p class="muted ref-citation">${escapeHtml(reference.citation)}</p>
    ${reference.note ? `<p class="muted ref-citation">${escapeHtml(reference.note)}</p>` : ''}
  </td>
  <td data-label="السنة والمصدر">${reference.year ? escapeHtml(String(reference.year)) : '—'}<br /><span class="muted">${escapeHtml(
    reference.source || '—'
  )}</span></td>
  <td data-label="الحالة">
    <form method="post" action="/references/${escapeHtml(reference.id)}/status" class="inline-form ref-status">
      <select name="status" aria-label="حالة قراءة المرجع">${statusOptions}</select>
      <button class="btn btn-sm" type="submit">تحديث</button>
    </form>
  </td>
  <td data-label="إجراءات">
    <div class="links row-actions">
    ${
      reference.hasFile
        ? `<a class="btn btn-sm btn-quiet" href="/library/${encodeURIComponent(reference.libraryItemId)}/file?inline=1" target="_blank" rel="noopener">${icon(
            'book',
            'icon-sm'
          )} الكتاب</a>
           <a class="btn btn-sm btn-quiet" href="/library/${escapeHtml(reference.libraryItemId)}/file">${icon(
             'download',
             'icon-sm'
           )} تحميل</a>`
        : reference.externalUrl
          ? `<a class="btn btn-sm btn-quiet" href="${escapeHtml(reference.externalUrl)}" target="_blank" rel="noopener">المصدر ↗</a>`
          : ''
    }
      <a class="btn btn-sm btn-quiet" href="/notes?ref=${escapeHtml(reference.id)}">ملاحظات (${escapeHtml(
    reference.notesCount || 0
  )})</a>
      <form method="post" action="/references/${escapeHtml(reference.id)}/delete" class="inline-form">
        <button class="btn btn-sm btn-danger" type="submit">حذف</button>
      </form>
    </div>
  </td>
</tr>`;
}

/** Renders a library result with add and access actions. */
function renderLibraryItem(item, stepKey) {
  // Prefer the stored file, otherwise use the original source URL.
  const access = item.hasFile
    ? `<a class="btn btn-sm" href="/library/${encodeURIComponent(item.id)}/file?inline=1" target="_blank" rel="noopener">${icon(
        'book',
        'icon-sm'
      )} معاينة</a>
       <a class="btn btn-sm" href="/library/${encodeURIComponent(item.id)}/file">${icon('download', 'icon-sm')} تحميل</a>`
    : item.externalUrl
      ? `<a class="btn btn-sm" href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener">${icon(
          'book',
          'icon-sm'
        )} فتح المصدر ↗</a>`
      : '<span class="badge">بيانات فقط</span>';

  return `<article class="lib-item">
  <h3>${escapeHtml(item.title)}</h3>
  <p class="muted">${escapeHtml(item.citation)}</p>
  <div class="links">
    ${
      item.added
        ? `<span class="badge badge-active">${icon('check', 'icon-sm')} في مراجعي</span>`
        : `<form method="post" action="/references" class="inline-form">
      <input type="hidden" name="library_item_id" value="${escapeHtml(item.id)}" />
      <input type="hidden" name="step" value="${escapeHtml(stepKey || '')}" />
      <button class="btn btn-primary" type="submit">${icon('plus', 'icon-sm')} أضف إلى مراجعي</button>
    </form>`
    }
    ${access}
    ${item.hasFile && item.sizeBytes ? `<span class="badge">${escapeHtml(formatFileSize(item.sizeBytes))}</span>` : ''}
    ${item.year ? `<span class="badge">${escapeHtml(String(item.year))}</span>` : ''}
    ${item.field ? `<span class="badge">${escapeHtml(item.field)}</span>` : ''}
  </div>
</article>`;
}

/** Renders an external literature result with citation and access links. */
function renderWebReference(item, stepKey) {
  const bits = [
    item.authorText || 'بلا مؤلف محدد',
    item.year ? String(item.year) : '',
    item.venue || item.publisher || '',
    item.doi ? `DOI: ${item.doi}` : ''
  ].filter(Boolean);

  const link = item.pdfUrl || item.url || '';

  return `<article class="lib-item lib-card">
  <div class="lib-card-head">
    <h3>${escapeHtml(item.title)}</h3>
    <div class="lib-badges">
      ${item.isOpenAccess ? `<span class="badge badge-active">${escapeHtml(item.sources[0] || 'مفتوح')}</span>` : `<span class="badge">${escapeHtml(item.sources[0] || 'مصدر')}</span>`}
      ${item.citations ? `<span class="badge">${escapeHtml(formatNumber(item.citations))} استشهاد</span>` : ''}
    </div>
  </div>
  <p class="lib-meta">${bits.map((part) => `<span>${escapeHtml(part)}</span>`).join('<span>·</span>')}</p>
  ${item.abstract ? `<p class="lib-abs">${escapeHtml(item.abstract.slice(0, 260))}${item.abstract.length > 260 ? '…' : ''}</p>` : ''}
  <div class="lib-actions">
    <form class="inline-form" method="post" action="/references/web">
      <input type="hidden" name="title" value="${escapeHtml(item.title)}" />
      <input type="hidden" name="authors" value="${escapeHtml(item.authorText)}" />
      <input type="hidden" name="year" value="${escapeHtml(String(item.year || ''))}" />
      <input type="hidden" name="venue" value="${escapeHtml(item.venue || item.publisher || '')}" />
      <input type="hidden" name="doi" value="${escapeHtml(item.doi)}" />
      <input type="hidden" name="url" value="${escapeHtml(item.url || '')}" />
      <input type="hidden" name="step" value="${escapeHtml(stepKey || '')}" />
      <button class="btn btn-primary btn-sm" type="submit">${icon('plus', 'icon-sm')} أضف إلى مراجعي</button>
    </form>
    ${link ? `<a class="btn btn-sm" href="${escapeHtml(link)}" target="_blank" rel="noopener">${item.pdfUrl ? 'تحميل PDF' : 'فتح المصدر'} ↗</a>` : ''}
    ${item.doi ? `<a class="btn btn-quiet btn-sm" href="https://doi.org/${escapeHtml(item.doi)}" target="_blank" rel="noopener">DOI ↗</a>` : ''}
  </div>
</article>`;
}

/** Renders the external literature-search form and results. */
function renderWebSearchPanel({ web, webQuery, webSource, webYearFrom = 0, webYearTo = 0, webSources = [], stepKey }) {
  const optionTag = (source) =>
    `<option value="${escapeHtml(source.id)}"${source.id === webSource ? ' selected' : ''}>${escapeHtml(source.label)}</option>`;
  // Group sources by type for selection.
  const groupOptions = SOURCE_GROUPS.map((group) => ({
    label: group.label,
    options: webSources.filter((source) => sourceGroup(source.id) === group.id).map(optionTag)
  })).filter((entry) => entry.options.length);
  const options = [
    `<option value=""${!webSource ? ' selected' : ''}>كل المصادر (بحث شامل)</option>`,
    ...groupOptions.map((entry) => `<optgroup label="${escapeHtml(entry.label)}">${entry.options.join('')}</optgroup>`)
  ].join('');

  const results = web?.items || [];
  const errors = (web?.errors || []).filter((entry) => entry.error);

  // Show the visible-result count above the list.
  const countBadge = webQuery
    ? `<div class="notice mt-12" role="status"><b>عدد المراجع الظاهرة:</b> ${String(results.length)}</div>`
    : '';

  // Keep the active year range visible even when there are no results.
  const periodNote =
    webYearFrom || webYearTo ? `فترة الإصدار: ${webYearFrom || '…'}–${webYearTo || '…'}` : '';
  const triedLine = web?.tried?.length
    ? `بحثنا في: ${web.tried.map((entry) => {
        const label = webSources.find((source) => source.id === entry.source)?.label || entry.source;
        return `${escapeHtml(label.split(' — ')[0])} (${entry.count})`;
      }).join(' · ')}`
    : '';
  const metaLine = [triedLine, periodNote].filter(Boolean).join(' · ');

  return `<section class="card">
  <div class="card-head">
    <h2>${icon('book', 'icon-sm')} ابحث في قواعد البيانات العلمية</h2>
    <span class="muted">بحث متوازٍ في قواعد البيانات المتاحة</span>
  </div>
  <p class="muted">
    ابحث بالكلمات المفتاحية (عنوان · مفهوم · كلمات مفتاحية إنجليزية وعربية) في المصادر العالمية
    والأوروبية والعربية: Crossref وOpenAlex وSemantic Scholar وDOAJ وCORE وIEEE Xplore
    وACM وarXiv وEurope PMC وPubMed Central وHAL وBASE وSSRN وSpringer وWiley
    وTaylor &amp; Francis وSAGE وUnpaywall وInternet Archive ومكتبة الكونجرس
    ومستودع الجامعات المغربية Toubkal — فتحصل على المؤلفين والمجلة
    والسنة وDOI ورابط المصدر ونسخة PDF مفتوحة إن وُجدت. ونقّص النتائج بفلتر
    <b>فترة الإصدار (من – إلى)</b> إن تبحث عن مراجع زمن محدّد.
  </p>
  <form class="toolbar" method="get" action="/library" data-literature-search>
    ${stepKey ? `<input type="hidden" name="step" value="${escapeHtml(stepKey)}" />` : ''}
    <input type="hidden" name="q" value="" />
    <input type="search" name="wq" value="${escapeHtml(webQuery || '')}" placeholder="مثال: machine learning in higher education" />
    <select name="wsrc" aria-label="المصدر">${options}</select>
    <span class="year-range" role="group" aria-label="فلتر فترة الإصدار">
      <input type="number" name="wfrom" min="1500" max="2100" inputmode="numeric" placeholder="من سنة" aria-label="من سنة الإصدار" value="${webYearFrom || ''}" />
      <span class="year-sep" aria-hidden="true">–</span>
      <input type="number" name="wto" min="1500" max="2100" inputmode="numeric" placeholder="إلى سنة" aria-label="إلى سنة الإصدار" value="${webYearTo || ''}" />
    </span>
    <button class="btn btn-primary" type="submit">${icon('searchCheck', 'icon-sm')} ابحث</button>
    <div class="search-progress" data-search-progress hidden role="status" aria-live="polite">
      <span class="search-progress-track" aria-hidden="true"><span></span></span>
      <span>جارٍ البحث في جميع المصادر العلمية…</span>
    </div>
  </form>

  ${countBadge}
  ${
    results.length
      ? `<div class="lib-list mt-16">${results.map((item) => renderWebReference(item, stepKey)).join('')}</div>
         ${metaLine ? `<p class="muted mt-8">${metaLine}</p>` : ''}`
      : webQuery
        ? `<div class="empty mt-16">لا نتائج${errors.length ? ` — ${escapeHtml(errors[0].error)}` : ''}${periodNote ? ` (${escapeHtml(periodNote)})` : ''}. جرّب كلمات إنجليزية أدق أو مصدراً آخر${periodNote ? ' أو وسّع فترة الإصدار' : ''}.</div>`
        : '<div class="empty mt-16">اكتب كلمة بحث وستظهر لك المراجع مع روابطها وبياناتها كاملة.</div>'
  }
</section>`;
}

/** Renders the platform library and external-search page. */
export function renderLibraryPage({
  account,
  unread = 0,
  query = '',
  results = [],
  stepKey = '',
  flash = null,
  web = null,
  webQuery = '',
  webSource = '',
  webYearFrom = 0,
  webYearTo = 0,
  webSources = [],
  profileNotice = ''
}) {
  const platformHtml = query
    ? results.length
      ? `<div class="lib-list">${results.map((item) => renderLibraryItem(item, stepKey)).join('')}</div>`
      : '<div class="empty">لا نتائج في مكتبة المنصة لهذا البحث — جرّب كلمة أخرى أو أضف مرجعاً من نتائج البحث الخارجي أعلاه.</div>'
    : '<div class="empty">اكتب كلمة بحث (عنوان، مؤلف، أو مصدر) للبحث في مكتبة المنصة.</div>';

  const body = `${flashBox(flash)}
${
  profileNotice
    ? `<div class="notice"><b>ترشيح المراجع يحتاج تخصصك.</b> ${profileNotice}</div>`
    : ''
}

${renderWebSearchPanel({ web, webQuery, webSource, webYearFrom, webYearTo, webSources, stepKey })}

<section class="card">
  <div class="card-head">
    <h2>${icon('book', 'icon-sm')} مكتبة المنصة</h2>
    <span class="muted">كتب ومراجع تملكها المنصة — معاينة وتحميل وإضافة إلى المراجع</span>
  </div>
  <form class="toolbar" method="get" action="/library">
    ${stepKey ? `<input type="hidden" name="step" value="${escapeHtml(stepKey)}" />` : ''}
    <input type="search" name="q" value="${escapeHtml(query)}" placeholder="ابحث بالعنوان أو المؤلف أو المجلة" />
    <button class="btn btn-primary" type="submit">${icon('searchCheck', 'icon-sm')} بحث</button>
  </form>
  ${platformHtml}
</section>`;

  return renderLayout({
    title: 'المكتبة',
    subtitle: 'ابحث في القواعد العلمية ومكتبة المنصة',
    area: 'app',
    activeKey: 'library',
    account,
    unread,
    scripts: ['/js/app-shell.js', '/js/library-search-progress.js'],
    body
  });
}


/** Renders a note card and its actions. */
function renderNoteCard(note, { stepTitles, editing = false, focus = false }) {
  const tags = note.tags.length
    ? `<p class="note-tags">${note.tags.map((tag) => `<span class="chip">#${escapeHtml(tag)}</span>`).join('')}</p>`
    : '';
  const step = note.stepKey
    ? `<p class="muted">${icon('clipboard', 'icon-sm')} مرتبطة بـ: ${escapeHtml(
        stepTitles[note.stepKey] || note.stepKey
      )}</p>`
    : '';

  const bodyHtml = `
  <p class="note-body">${escapeHtml(note.body || '—')}</p>
  ${tags}
  ${step}
  <p class="muted">آخر تحديث: ${escapeHtml(formatDateTime(note.updatedAt))}${
    note.createdAt !== note.updatedAt ? ` · أُنشئت ${escapeHtml(formatDate(note.createdAt))}` : ''
  }</p>`;

  if (!editing) {
    return `<article class="note-card${note.pinned ? ' is-pinned' : ''}">
  <header class="note-head">
    <h3>${note.pinned ? `${icon('pin', 'icon-sm')} ` : ''}${escapeHtml(note.title)}</h3>
    <div class="note-actions">
      <form method="post" action="/notes/${escapeHtml(note.id)}/pin" class="inline-form">
        <button class="btn btn-quiet" type="submit">${note.pinned ? 'إلغاء التثبيت' : 'تثبيت'}</button>
      </form>
      <a class="btn btn-quiet" href="/notes?edit=${escapeHtml(note.id)}${
        note.stepKey ? `&step=${encodeURIComponent(note.stepKey)}` : ''
      }">${icon('edit', 'icon-sm')} تعديل</a>
      <a class="btn btn-quiet" href="/chat?note=${escapeHtml(note.id)}&title=${encodeURIComponent(
        `راجع ملاحظتي: ${note.title}`
      )}">${icon('message', 'icon-sm')} ناقش مع المشرف</a>
      <form method="post" action="/notes/${escapeHtml(note.id)}/delete" class="inline-form">
        <button class="btn btn-danger" type="submit">${icon('trash', 'icon-sm')} حذف</button>
      </form>
    </div>
  </header>
  ${bodyHtml}
</article>`;
  }

  return `<article class="note-card is-editing${focus ? ' is-focus' : ''}">
  <header class="note-head"><h3>${icon('edit', 'icon-sm')} تعديل الملاحظة</h3></header>
  <form method="post" action="/notes/${escapeHtml(note.id)}" class="form-card">
    <div class="field"><label for="n_title_${escapeHtml(note.id)}">العنوان</label>
      <input type="text" id="n_title_${escapeHtml(note.id)}" name="title" value="${escapeHtml(note.title)}" maxlength="300" /></div>
    <div class="field"><label for="n_body_${escapeHtml(note.id)}">النص</label>
      <textarea id="n_body_${escapeHtml(note.id)}" name="body" rows="6" maxlength="20000">${escapeHtml(note.body)}</textarea></div>
    <div class="field"><label for="n_tags_${escapeHtml(note.id)}">الوسوم (مفصولة بفواصل)</label>
      <input type="text" id="n_tags_${escapeHtml(note.id)}" name="tags" value="${escapeHtml(note.tags.join(', '))}" maxlength="400" /></div>
    ${stepSelect(stepOptionsLocal(stepTitles), note.stepKey, 'step', `n_step_${note.id}`)}
    <label class="check"><input type="checkbox" name="pinned" value="1"${note.pinned ? ' checked' : ''} /> تثبيت الملاحظة</label>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">حفظ التعديلات</button>
      <a class="btn btn-quiet" href="/notes${note.stepKey ? `?step=${encodeURIComponent(note.stepKey)}` : ''}">إلغاء</a>
    </div>
  </form>
</article>`;
}

/** Builds step options from the displayed journey. */
function stepOptionsLocal(stepTitles) {
  return Object.entries(stepTitles).map(([value, label]) => ({ value, label }));
}

/** Renders the notes page and its filters. */
export function renderNotesPage({ account, unread = 0, notes = [], query = '', stepKey = '', referenceId = '', stepOptions = [], stepTitles = {}, editingId = '', flash = null }) {
  const noteCards = notes.length
    ? notes.map((note) => renderNoteCard(note, { stepTitles, editing: note.id === editingId })).join('')
    : '<div class="empty">لا ملاحظات بعد — اكتب أول فكرة أو نتيجة من مشرفك الذكي.</div>';

  const referenceFilter = referenceId
    ? `<div class="chips"><span class="chip">ملاحظات مرتبطة بمرجع محدد</span>
      <a class="btn btn-quiet" href="/notes">إلغاء الفلترة</a></div>`
    : '';

  const body = `<div class="grid">
  <section class="card">
    <h2>ملاحظة جديدة</h2>
    <form method="post" action="/notes" class="form-card">
      <div class="field"><label for="new_title">العنوان</label><input type="text" id="new_title" name="title" maxlength="300" placeholder="مثال: ملاحظات من اجتماع المشرف" /></div>
      <div class="field"><label for="new_body">النص</label><textarea id="new_body" name="body" rows="5" maxlength="20000" placeholder="اكتب الفكرة أو الاقتباس أو السؤال"></textarea></div>
      <div class="field"><label for="new_tags">الوسوم (مفصولة بفواصل)</label><input type="text" id="new_tags" name="tags" maxlength="400" placeholder="منهجية، مراجع" /></div>
      ${referenceId ? `<input type="hidden" name="reference_id" value="${escapeHtml(referenceId)}" />` : ''}
      ${stepSelect(stepOptions, stepKey)}
      <label class="check"><input type="checkbox" name="pinned" value="1" /> تثبيت الملاحظة</label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('list', 'icon-sm')} احفظ الملاحظة</button></div>
    </form>
  </section>

  <section class="card">
    <h2>مفكرتي (${notes.length})</h2>
    <form class="toolbar" method="get" action="/notes">
      <input type="search" name="q" value="${escapeHtml(query)}" placeholder="ابحث في العناوين والنصوص والوسوم" />
      ${stepKey ? `<input type="hidden" name="step" value="${escapeHtml(stepKey)}" />` : ''}
      ${referenceId ? `<input type="hidden" name="ref" value="${escapeHtml(referenceId)}" />` : ''}
      <button class="btn" type="submit">بحث</button>
      ${stepKey || query || referenceId ? '<a class="btn btn-quiet" href="/notes">مسح الفلترة</a>' : ''}
    </form>
    ${referenceFilter}
    <div class="note-list">${noteCards}</div>
  </section>
</div>

${flashBox(flash)}`;

  return renderLayout({
    title: 'المفكرة',
    subtitle: 'أفكارك واقتباساتك وملاحظاتك مرتبطة بخطوات بحثك',
    area: 'app',
    activeKey: 'notes',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** Renders a file row and its actions. */
function renderFileRow(file, stepTitles) {
  const viewBtn = file.previewable
    ? `<a class="btn btn-sm btn-quiet" href="/files/${escapeHtml(file.id)}/view">${icon('searchCheck', 'icon-sm')} عرض</a>`
    : '';

  return `<tr>
  <td data-label="الملف">
    <div class="file-cell"><b class="file-name" title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</b>
    <p class="file-meta muted">${escapeHtml(file.fileName)}</p></div>
  </td>
  <td data-label="النوع والحجم">${escapeHtml(file.kind)}<br /><span class="muted">${escapeHtml(formatFileSize(file.sizeBytes))}</span></td>
  <td data-label="التاريخ">${escapeHtml(formatDate(file.createdAt))}</td>
  <td data-label="إجراءات">
    <div class="links row-actions">
    ${viewBtn}
    <a class="btn btn-sm btn-quiet" href="/files/${escapeHtml(file.id)}/raw">${icon('download', 'icon-sm')} تحميل</a>
    <form method="post" action="/files/${escapeHtml(file.id)}/delete" class="inline-form">
      <button class="btn btn-sm btn-danger" type="submit">${icon('trash', 'icon-sm')} حذف</button>
    </form>
    </div>
  </td>
</tr>`;
}

/** Renders the storage-usage summary. */
function renderStorageBar(summary) {
  const tone = summary.isFull ? 'is-full' : summary.isNearFull ? 'is-near' : '';
  const hint = summary.isFull
    ? 'وصلت للحد الأقصى — احذف ملفاً لتحرير مساحة.'
    : summary.isNearFull
      ? 'المساحة أوشكت على الامتلاء.'
      : 'احذف أي ملف لتحرير مساحته فوراً.';

  // Use service-formatted values so displayed units match calculations.
  const usedLabel = summary.usedLabel ?? `${summary.usedMb} MB`;
  const quotaLabel = summary.quotaLabel ?? `${summary.quotaMb} MB`;
  const remainingLabel = summary.remainingLabel ?? `${summary.remainingMb} MB`;
  const width = summary.barWidth ?? summary.percent ?? 0;
  const percentText = width > 0 && (summary.percent ?? 0) > 0 ? ` (${summary.percent}%)` : '';

  return `<div class="storage-bar ${tone}">
  <div class="storage-head">
    <b>${icon('paperclip', 'icon-sm')} مساحة ملفاتك</b>
    <span>${escapeHtml(usedLabel)} من ${escapeHtml(quotaLabel)}${escapeHtml(percentText)}</span>
  </div>
  <div class="meter"><i style="width:${width}%"></i></div>
  <p class="muted">المتاح: ${escapeHtml(remainingLabel)} · ${escapeHtml(hint)}</p>
</div>`;
}

/** Renders spreadsheet sheets with escaped cell values and bounded scrolling. */
function renderSheetPreview({ sheetData, sheetError = '' }) {
  if (sheetError) return `<div class="alert">${escapeHtml(sheetError)}</div>`;
  if (!sheetData?.sheets?.length) {
    return '<div class="notice"><b>الملف فارغ.</b><p>لا توجد بيانات لعرضها هنا.</p></div>';
  }

  const sheets = sheetData.sheets;
  const sheetId = `sheet-${sheets.length}-${(sheets[0].name || '').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 20)}`;

  const tabs = sheets.length > 1
    ? `<div class="sheet-tabs" role="tablist">
    ${sheets
      .map(
        (sheet, index) =>
          `<a class="sheet-tab${index === 0 ? ' is-active' : ''}" href="#${sheetId}-${index}">${escapeHtml(sheet.name)}</a>`
      )
      .join('\n    ')}
  </div>`
    : '';

  const tables = sheets
    .map((sheet, index) => {
      const rows = sheet.rows || [];
      if (!rows.length) {
        return `<section id="${sheetId}-${index}" class="sheet-panel"><div class="alert">الورقة «${escapeHtml(sheet.name)}» فارغة.</div></section>`;
      }

      const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const head = `<tr>${Array.from({ length: width }, (_, col) => `<th>${escapeHtml(rows[0][col] ?? '')}</th>`).join('')}</tr>`;
      const body = rows
        .slice(1)
        .map(
          (row) =>
            `<tr>${Array.from({ length: width }, (_, col) => {
              const value = row[col] ?? '';
              return `<td${value === '' ? ' class="is-empty"' : ''}>${escapeHtml(value)}</td>`;
            }).join('')}</tr>`
        )
        .join('\n      ');

      return `<section id="${sheetId}-${index}" class="sheet-panel">
    <div class="sheet-wrap">
      <table class="sheet-table">
        <thead>${head}</thead>
        <tbody>
      ${body}
        </tbody>
      </table>
    </div>
    <p class="muted">الورقة «${escapeHtml(sheet.name)}» · ${Math.max(rows.length - 1, 0)} صف${sheet.truncated ? ' (عُرض أول 200 صف فقط)' : ''}</p>
  </section>`;
    })
    .join('\n  ');

  const hiddenSheets = sheetData.truncated ? '<p class="muted">الملف يحتوي أوراقاً إضافية لم تُعرض.</p>' : '';

  return `<div class="file-preview file-preview--sheet">${tabs}
  ${tables}
  ${hiddenSheets}
</div>`;
}

/** Renders a safe inline preview or download prompt for an owned file. */
export function renderFileViewerPage({
  account,
  unread = 0,
  file,
  kind,
  textContent = null,
  sheetData = null,
  sheetError = '',
  stepTitle = '',
  missing = false
}) {
  const actions = `<div class="links">
  <a class="btn btn-quiet" href="/files">${icon('file', 'icon-sm')} كل ملفياتي</a>
  <a class="btn btn-primary" href="/files/${escapeHtml(file.id)}/raw">${icon('download', 'icon-sm')} تحميل</a>
  <form method="post" action="/files/${escapeHtml(file.id)}/delete" class="inline-form">
    <button class="btn btn-danger" type="submit">${icon('trash', 'icon-sm')} حذف</button>
  </form>
</div>`;

  const meta = `<dl class="kv file-meta">
  <div><dt>الاسم</dt><dd>${escapeHtml(file.fileName)}</dd></div>
  <div><dt>النوع</dt><dd>${escapeHtml(file.kind)}</dd></div>
  <div><dt>الحجم</dt><dd>${escapeHtml(formatFileSize(file.sizeBytes))}</dd></div>
  <div><dt>تاريخ الرفع</dt><dd>${escapeHtml(formatDateTime(file.createdAt))}</dd></div>
  ${stepTitle ? `<div><dt>الخطوة</dt><dd>${escapeHtml(stepTitle)}</dd></div>` : ''}
</dl>`;

  let preview = '';
  if (missing) {
    preview = '<div class="alert">ملف البايتات مفقود على القرص — يمكنك حذفه ورفعه من جديد.</div>';
  } else if (kind === 'image') {
    preview = `<div class="file-preview file-preview--image">
    <img src="/files/${escapeHtml(file.id)}/raw?inline=1" alt="${escapeHtml(file.title)}" loading="lazy" />
  </div>`;
  } else if (kind === 'pdf') {
    preview = `<div class="file-preview file-preview--pdf">
    <iframe src="/files/${escapeHtml(file.id)}/raw?inline=1" title="${escapeHtml(file.title)}"></iframe>
  </div>
  <p class="muted">إن لم تظهر المعاينة، افتح الملف في تبويب جديد أو حمّله.</p>`;
  } else if (kind === 'text' && textContent !== null) {
    preview = `<pre class="file-preview file-preview--text" dir="auto">${escapeHtml(textContent)}</pre>`;
  } else if (kind === 'text') {
    preview = '<div class="alert">الملف نصي لكنه أكبر من حد المعاينة — حمّله لعرضه كاملاً.</div>';
  } else if (kind === 'sheet') {
    preview = renderSheetPreview({ sheetData, sheetError });
  } else {
    preview = `<div class="notice">
  <b>لا يعرض المتصفح هذا النوع داخل الصفحة.</b>
  <p>حمّل الملف وافتحه في برنامجه (Word / PowerPoint).</p>
</div>`;
  }

  const body = `<div class="file-viewer">
  <div class="card file-viewer-info">
    <h2>${escapeHtml(file.title)}</h2>
    ${meta}
    ${actions}
  </div>
  <div class="card file-viewer-stage">
    ${preview}
  </div>
</div>`;

  return renderLayout({
    title: file.title,
    subtitle: `معاينة ${file.kind} · ${formatFileSize(file.sizeBytes)}`,
    area: 'app',
    activeKey: 'files',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** Renders the file-upload form and filtered file list. */
export function renderFilesPage({ account, unread = 0, files = [], summary = { total: 0, bytes: 0, usedMb: 0, quotaMb: 0, remainingMb: 0, percent: 0, barWidth: 0, usedLabel: '0 بايت', quotaLabel: '500 MB', remainingLabel: '500 MB' }, references = [], refCounts = {}, stepKey = '', stepOptions = [], stepTitles = {}, maxMb = 100, allowedTypes = '', flash = null }) {
  const rows = files.length
    ? `<div class="table-scroll"><table class="file-table">
  <thead><tr><th>الملف</th><th>النوع والحجم</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
  <tbody>${files.map((file) => renderFileRow(file, stepTitles)).join('')}</tbody>
</table></div>`
    : '<div class="empty">لا ملفات بعد — ارفع أول مستند (PDF أو Word) ليعمل عليه المشرف الذكي.</div>';

  // Show references added from external or platform-library results.
  const refsHtml = references.length
    ? `<div class="table-scroll"><table class="ref-table">
  <thead><tr><th>المرجع</th><th>السنة والمصدر</th><th>الحالة</th><th>إجراءات</th></tr></thead>
  <tbody>${references.map((item) => renderReferenceRow(item)).join('')}</tbody>
</table></div>`
    : '<div class="empty">لا مراجع بعد — أضفها من نتائج <a href="/library">المكتبة</a> بزر «أضف إلى مراجعي».</div>';

  const refsCard = `<section class="card">
  <div class="notif-head">
    <h2>${icon('book', 'icon-sm')} مراجعي (${formatNumber(refCounts.total || 0)})</h2>
    <div class="chips">
      ${READING_STATUSES.map(
        (item) => `<a class="chip" href="/files?status=${escapeHtml(item.value)}">${escapeHtml(item.label)}: ${formatNumber(
          refCounts[item.value] || 0
        )}</a>`
      ).join('')}
    </div>
  </div>
  ${refsHtml}
</section>`;

  const body = `<div class="grid">
  <section class="card">
    <h2>${icon('upload', 'icon-sm')} ارفع ملفاً</h2>
    <form method="post" action="/files" enctype="multipart/form-data" class="form-card">
      <div class="field">
        <span class="field-label">الملف</span>
        <div class="file-picker">
          <input
            type="file"
            id="file_input"
            name="file"
            required
            class="file-picker-input"
            accept="${escapeHtml(FILE_UPLOAD_LIMITS.allowedExtensions.map((ext) => `.${ext}`).join(','))}"
            data-max-mb="${Number(maxMb) || 0}"
            data-allowed-ext="${escapeHtml(FILE_UPLOAD_LIMITS.allowedExtensions.join(','))}"
            data-remaining-bytes="${Number(
              summary.remainingBytes ?? Math.max(0, (summary.quotaBytes ?? (summary.quotaMb || 0) * 1048576) - (summary.bytes || 0))
            )}"
          />
          <label class="file-picker-label" for="file_input">
            <span class="file-picker-icon">${icon('paperclip')}</span>
            <span class="file-picker-text">
              <b class="file-picker-title">اختر ملفاً من جهازك</b>
              <span class="file-picker-hint">أو اسحبه وأفلته هنا · الحجم الأقصى ${escapeHtml(
                String(maxMb)
              )} MB</span>
            </span>
            <span class="file-picker-btn">استعراض</span>
          </label>
          <p class="file-picker-name" id="file-picked-name" aria-live="polite"></p>
          <!-- تنبيه فوري عند اختيار ملف مرفوض (نوع أو حجم أو مساحة) قبل الإرسال -->
          <p class="alert" id="file-upload-error" role="alert" aria-live="assertive" hidden></p>
        </div>
        <p class="form-hint">الأنواع المسموحة: ${escapeHtml(allowedTypes)}</p>
      </div>
      <div class="field"><label for="file_title">اسم وصفي (اختياري)</label><input type="text" id="file_title" name="title" maxlength="255" placeholder="مثال: مقترح البحث — النسخة الثانية" /></div>
      ${stepSelect(stepOptions, stepKey)}
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('upload', 'icon-sm')} رفع الملف</button></div>
    </form>
  </section>

  <section class="card">
    <h2>مساحتك</h2>
    ${renderStorageBar(summary)}
    <form class="toolbar" method="get" action="/files">
      ${stepKey ? `<select name="step" aria-label="فلترة بالخطوة">
        <option value="">كل الخطوات</option>
        ${stepOptions.map((item) => `<option value="${escapeHtml(item.value)}"${item.value === stepKey ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>` : ''}
      <button class="btn" type="submit">${icon('refresh', 'icon-sm')} عرض</button>
    </form>
  </section>
</div>

${flashBox(flash)}

${refsCard}

<section class="card">
  ${rows}
</section>`;

  return renderLayout({
    title: 'ملفاتي ومراجعي',
    subtitle: 'ارفع مستنداتك وأدر مراجعك التي أضفتها من المكتبة في مكان واحد',
    area: 'app',
    activeKey: 'files',
    account,
    unread,
    // The custom file picker is a progressive enhancement.
    scripts: ['/js/file-picker.js', '/js/app-shell.js'],
    body
  });
}



