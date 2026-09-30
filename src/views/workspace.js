import { formatFileSize } from '../services/files.js';
import { READING_STATUSES } from '../constants.js';
import { formatDate, formatDateTime, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحات مساحة عمل الباحث (1E): المراجع والمفكرة والملفات.
 * كلها HTML مولّد على الخادم (نماذج POST عادية + 303 redirect) بلا أي سكربت سطري،
 * فالصفحات تعمل حتى لو تعطّل JavaScript. الروابط بين الصفحات تمر بـ ?step=<step_key>
 * القادمة من صفحة «مسار البحث».
 */

/** قائمة منسدلة بخطوات المسار لربط العنصر بالخطوة الحالية. */
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

/** تنبيه النتيجة بعد التحويل (ok / err من الرابط). */
function flashBox(flash) {
  if (!flash?.message) return '';
  return flash.type === 'error' ? `<div class="alert">${escapeHtml(flash.message)}</div>` : `<div class="notice">${escapeHtml(flash.message)}</div>`;
}

/** تسمية الخطوة من مفاتيحها (مصفوفة مرتّبة لعرضها في الجداول). */
function stepLabel(stepTitles, key) {
  return key ? stepTitles[key] || key : '—';
}

/** صف مرجع في «مراجعي»: التوثيق + حالة القراءة + ملاحظات مرتبطة. */
function renderReferenceRow(reference, stepTitles) {
  const statusOptions = READING_STATUSES.map(
    (item) =>
      `<option value="${escapeHtml(item.value)}"${item.value === reference.status ? ' selected' : ''}>${escapeHtml(
        item.label
      )}</option>`
  ).join('');

  return `<tr>
  <td>
    <b>${escapeHtml(reference.title)}</b>
    <p class="muted ref-citation">${escapeHtml(reference.citation)}</p>
    ${reference.note ? `<p class="muted">${escapeHtml(reference.note)}</p>` : ''}
  </td>
  <td>${reference.year ? escapeHtml(String(reference.year)) : '—'}<br /><span class="muted">${escapeHtml(
    reference.source || '—'
  )}</span></td>
  <td>${escapeHtml(stepLabel(stepTitles, reference.stepKey))}</td>
  <td>
    <form method="post" action="/references/${escapeHtml(reference.id)}/status" class="inline-form">
      <select name="status" aria-label="حالة قراءة المرجع">${statusOptions}</select>
      <button class="btn" type="submit">تحديث</button>
    </form>
  </td>
  <td>
    <a class="btn btn-quiet" href="/notes?ref=${escapeHtml(reference.id)}">ملاحظات (${reference.notesCount})</a>
    <form method="post" action="/references/${escapeHtml(reference.id)}/delete" class="inline-form">
      <button class="btn btn-danger" type="submit">حذف</button>
    </form>
  </td>
</tr>`;
}

/** بطاقة نتيجة من المكتبة مع زر الإضافة إلى «مراجعي». */
function renderLibraryItem(item, stepKey) {
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
    ${item.year ? `<span class="badge">${escapeHtml(String(item.year))}</span>` : ''}
    ${item.field ? `<span class="badge">${escapeHtml(item.field)}</span>` : ''}
  </div>
</article>`;
}

/** صفحة المراجع: بحث في المكتبة + إضافة يدوية + «مراجعي» مع تغيير الحالة. */
export function renderReferencesPage({ account, unread = 0, query = '', results = [], references = [], counts = {}, stepKey = '', stepOptions = [], stepTitles = {}, flash = null }) {
  const libraryHtml = query
    ? results.length
      ? `<div class="lib-list">${results.map((item) => renderLibraryItem(item, stepKey)).join('')}</div>`
      : '<div class="empty">لا نتائج في المكتبة لهذا البحث — جرّب كلمة أخرى أو أضف المرجع يدوياً.</div>'
    : '<div class="empty">اكتب كلمة بحث (عنوان، مؤلف، أو مصدر) للبحث في مكتبة المنصة.</div>';

  const mineHtml = references.length
    ? `<table class="ref-table">
  <thead><tr><th>المرجع</th><th>السنة والمصدر</th><th>الخطوة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
  <tbody>${references.map((item) => renderReferenceRow(item, stepTitles)).join('')}</tbody>
</table>`
    : '<div class="empty">لا مراجع بعد — أضف من المكتبة أو يدوياً من النموذج بالأعلى.</div>';

  const body = `<div class="grid">
  <section class="card">
    <h2>مكتبة المنصة</h2>
    <form class="toolbar" method="get" action="/references">
      ${stepKey ? `<input type="hidden" name="step" value="${escapeHtml(stepKey)}" />` : ''}
      <input type="search" name="q" value="${escapeHtml(query)}" placeholder="ابحث بالعنوان أو المؤلف أو المجلة" />
      <button class="btn btn-primary" type="submit">${icon('searchCheck', 'icon-sm')} بحث</button>
    </form>
    ${libraryHtml}
  </section>

  <section class="card">
    <h2>أضف مرجعاً يدوياً</h2>
    <form method="post" action="/references" class="form-card">
      <div class="field"><label for="r_title">العنوان *</label><input type="text" id="r_title" name="title" required maxlength="500" /></div>
      <div class="field-row">
        <div class="field"><label for="r_authors">المؤلف/المؤلفون</label><input type="text" id="r_authors" name="authors" maxlength="500" /></div>
        <div class="field"><label for="r_year">السنة</label><input type="text" id="r_year" name="year" inputmode="numeric" maxlength="4" /></div>
      </div>
      <div class="field"><label for="r_source">المصدر (مجلة / موقع / قسم)</label><input type="text" id="r_source" name="source" maxlength="255" /></div>
      <div class="field"><label for="r_note">لماذا أضفته؟</label><textarea id="r_note" name="note" rows="2" maxlength="2000"></textarea></div>
      ${stepSelect(stepOptions, stepKey)}
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('book', 'icon-sm')} إضافة إلى مراجعي</button></div>
    </form>
  </section>
</div>

${flashBox(flash)}

<section class="card">
  <div class="notif-head">
    <h2>مراجعي (${formatNumber(counts.total || 0)})</h2>
    <div class="chips">
      ${READING_STATUSES.map(
        (item) => `<a class="chip" href="/references?status=${escapeHtml(item.value)}">${escapeHtml(item.label)}: ${formatNumber(
          counts[item.value] || 0
        )}</a>`
      ).join('')}
    </div>
  </div>
  ${mineHtml}
</section>`;

  return renderLayout({
    title: 'مراجعي',
    subtitle: 'ابحث في مكتبة المنصة ونظّم مراجعك مع ربطها بخطوات بحثك',
    area: 'app',
    activeKey: 'references',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** بطاقة ملاحظة: نصها، وسومها، خطوتها، وأزرار التثبيت/التعديل/الحذف. */
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

/** خيارات الخطوة المشتقة من عناوين الخطوات المعروضة (للتعديل السريع). */
function stepOptionsLocal(stepTitles) {
  return Object.entries(stepTitles).map(([value, label]) => ({ value, label }));
}

/** صفحة المفكرة: نموذج إضافة + قائمة ملاحظات (بحث/فلترة بخطوة/تثبيت). */
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

/** صف ملف: النوع والحجم والخطوة وزر التحميل وزر الحذف. */
function renderFileRow(file, stepTitles) {
  return `<tr>
  <td>
    <b>${escapeHtml(file.title)}</b>
    <p class="muted">${escapeHtml(file.fileName)}</p>
  </td>
  <td>${escapeHtml(file.kind)}<br /><span class="muted">${escapeHtml(formatFileSize(file.sizeBytes))}</span></td>
  <td>${escapeHtml(stepTitles[file.stepKey] || (file.stepKey ? file.stepKey : '—'))}</td>
  <td>${escapeHtml(formatDate(file.createdAt))}</td>
  <td>
    <a class="btn btn-quiet" href="/files/${escapeHtml(file.id)}/raw">${icon('download', 'icon-sm')} تحميل</a>
    <form method="post" action="/files/${escapeHtml(file.id)}/delete" class="inline-form">
      <button class="btn btn-danger" type="submit">${icon('trash', 'icon-sm')} حذف</button>
    </form>
  </td>
</tr>`;
}

/** صفحة الملفات: نموذج رفع (multipart) + جدول الملفات مع فلترة بخطوة. */
export function renderFilesPage({ account, unread = 0, files = [], summary = { total: 0, bytes: 0 }, stepKey = '', stepOptions = [], stepTitles = {}, maxMb = 10, allowedTypes = '', flash = null }) {
  const rows = files.length
    ? `<table class="file-table">
  <thead><tr><th>الملف</th><th>النوع والحجم</th><th>الخطوة</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
  <tbody>${files.map((file) => renderFileRow(file, stepTitles)).join('')}</tbody>
</table>`
    : '<div class="empty">لا ملفات بعد — ارفع أول مستند (PDF أو Word) ليعمل عليه المشرف الذكي.</div>';

  const body = `<div class="grid">
  <section class="card">
    <h2>${icon('upload', 'icon-sm')} ارفع ملفاً</h2>
    <form method="post" action="/files" enctype="multipart/form-data" class="form-card">
      <div class="field">
        <span class="field-label">الملف</span>
        <div class="file-picker">
          <input type="file" id="file_input" name="file" required class="file-picker-input" />
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
        </div>
        <p class="form-hint">الأنواع المسموحة: ${escapeHtml(allowedTypes)}</p>
      </div>
      <div class="field"><label for="file_title">اسم وصفي (اختياري)</label><input type="text" id="file_title" name="title" maxlength="255" placeholder="مثال: مقترح البحث — النسخة الثانية" /></div>
      ${stepSelect(stepOptions, stepKey)}
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('upload', 'icon-sm')} رفع الملف</button></div>
    </form>
  </section>

  <section class="card">
    <h2>ملفاتي (${summary.total})</h2>
    <dl class="kv">
      <div><dt>الحجم الكلي</dt><dd>${escapeHtml(formatFileSize(summary.bytes))}</dd></div>
      <div><dt>المساحة المحمية</dt><dd>${escapeHtml(summary.total + ' ملف')} داخل مجلدك الخاص</dd></div>
    </dl>
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

<section class="card">
  ${rows}
</section>`;

  return renderLayout({
    title: 'ملفاتي',
    subtitle: 'ارفع مستنداتك (مقترح، نتائج، كود) ليتناولها المشرف الذكي',
    area: 'app',
    activeKey: 'files',
    account,
    unread,
    // منتقي الملف المخصّص (اسم الملف + السحب والإفلات) — تحسين اختياري
    scripts: ['/js/file-picker.js', '/js/app-shell.js'],
    body
  });
}



