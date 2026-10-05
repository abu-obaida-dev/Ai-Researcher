import { DEGREE_LEVELS } from '../constants.js';
import { formatDateTime, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة «مسار البحث» (1D): خطوات درجة الباحث مع حالته في كل خطوة،
 * وروابط ربط المرجع/الملاحظة/الملف بالخطوة، وزر «ابدأ مع المشرف» الذي
 * يفتح الشات بسياق الخطوة (/chat?step=…). النماذج تُرسل POST إلى /journey/steps/:key.
 */

/** اسم الدرجة المعروض (من DEGREE_LEVELS). */
function degreeLabel(value) {
  return DEGREE_LEVELS.find((item) => item.value === value)?.label || value || 'غير محددة';
}

/** تنبيه نتيجة العملية (يأتي من ?ok= / ?err= بعد الـ POST). */
function flashBox(flash) {
  if (!flash?.message) return '';

  return flash.type === 'error'
    ? `<div class="alert">${escapeHtml(flash.message)}</div>`
    : `<div class="notice">${escapeHtml(flash.message)}</div>`;
}

/** أزرار حالة الخطوة (radio مبثقة كأزرار) — الحالة الحالية محددة. */
function statusChoices(statuses, current) {
  return statuses
    .map((item) => {
      const checked = item.value === current ? ' checked' : '';
      return `<label class="step-status-choice is-${item.value}">
  <input type="radio" name="status" value="${item.value}"${checked} />
  <span>${escapeHtml(item.label)}</span>
</label>`;
    })
    .join('');
}

/** شريط روابط للخطوة: مراجعها وملاحظاتها وملفاتها والشات بسياقها. */
function stepLinks(step) {
  const key = encodeURIComponent(step.key);
  const chatHref = `/chat?step=${key}&title=${encodeURIComponent(`خطوة: ${step.title}`)}`;

  return `<div class="step-links">
  <a class="btn btn-primary step-chat" href="${chatHref}">${icon('message', 'icon-sm')} ابدأ مع المشرف</a>
  <a class="btn btn-quiet" href="/references?step=${key}">${icon('book', 'icon-sm')} مراجع الخطوة</a>
  <a class="btn btn-quiet" href="/notes?step=${key}">${icon('list', 'icon-sm')} ملاحظات الخطوة</a>
  <a class="btn btn-quiet" href="/files?step=${key}">${icon('clipboard', 'icon-sm')} ملفات الخطوة</a>
</div>`;
}

/** بطاقة خطوة واحدة: حالتها + ملاحظة المخرجات + سعر النقاط + روابطها. */
function renderStep(step, statuses) {
  const doneMark = step.status === 'done' ? `<span class="step-check">${icon('check', 'icon-sm')}</span>` : '';
  const completed = step.completedAt ? `تُمت في ${escapeHtml(formatDateTime(step.completedAt))}` : '';

  return `<article class="journey-step is-${step.status}">
  <header class="step-head">
    <span class="step-number">${escapeHtml(String(step.no))}</span>
    <div class="step-heading">
      <h3>${escapeHtml(step.title)} ${doneMark}</h3>
      <p class="muted">${escapeHtml(step.description || '')}</p>
    </div>
    <div class="step-badges">
      <span class="badge ${step.required ? 'badge-plan' : 'badge-off'}">${step.required ? 'إلزامية' : 'اختيارية'}</span>
      <span class="badge badge-active" title="سعر الخطوة من قائمة الأسعار">${escapeHtml(step.costLabel)} · ${escapeHtml(
        formatNumber(step.cost)
      )} نقطة</span>
    </div>
  </header>

  ${step.guidance ? `<p class="step-guidance"><b>كيف تنجزها:</b> ${escapeHtml(step.guidance)}</p>` : ''}

  ${stepLinks(step)}

  <form class="step-form" method="post" action="/journey/steps/${encodeURIComponent(step.key)}">
    <div class="field">
      <label for="note-${escapeHtml(step.key)}">${
        step.key === 'topic' ? 'عنوان موضوع البحث الذي اخترته *' : 'ملاحظة المخرجات (ماذا أنجزت في هذه الخطوة؟)'
      }</label>
      <textarea id="note-${escapeHtml(step.key)}" name="output_note" rows="2" maxlength="2000"
        placeholder="${
          step.key === 'topic'
            ? 'اكتب عنوان موضوع بحثك هنا — كل ما يُبنى عليه مراجعك لاحقاً في مرحلة الدراسات السابقة'
            : 'مثال: اخترت العنوان النهائي وحددت سؤال البحث'
        }">${escapeHtml(step.outputNote)}</textarea>
      ${
        step.key === 'topic'
          ? `<p class="form-hint">هذا العنوان هو المصدر الوحيد لبحث المراجع لاحقاً. يمكنك أيضاً كتابته في الشات (اكتب: «موضوعي: …») ونسجّله لك.</p>`
          : ''
      }
    </div>
    <div class="step-form-actions">
      <div class="step-status-group">${statusChoices(statuses, step.status)}</div>
      <button class="btn btn-primary" type="submit">حفظ الحالة</button>
      ${completed ? `<span class="muted">${completed}</span>` : ''}
    </div>
  </form>
</article>`;
}

/** صفحة مسار البحث كاملة. */
export function renderJourneyPage({ account, journey, profile, unread = 0, flash = null }) {
  const meter = `<div class="meter"><i style="width:${journey.percent}%"></i></div>`;
  const sourceNote =
    journey.source === 'database'
      ? 'خطوات مخصّصة لهذه الدرجة (يمكن للمدير تعديلها).'
      : 'الخطوات الافتراضية لهذه الدرجة — يمكن تفعيل نسخة مخصّصة لكل تخصص.';

  const body = `<div class="journey-grid">
  <section class="card journey-summary">
    <h2>${escapeHtml(journey.title)}</h2>
    <p class="muted">${escapeHtml(journey.description || '')}</p>
    ${meter}
    <dl class="kv">
      <div><dt>الدرجة</dt><dd>${escapeHtml(degreeLabel(profile?.degree_level))}</dd></div>
      <div><dt>التقدّم</dt><dd>${journey.done} من ${journey.total} خطوة (${journey.percent}%)</dd></div>
      <div><dt>الخطوة الحالية</dt><dd>${escapeHtml(journey.current ? journey.current.title : 'اكتمل المسار 🎉')}</dd></div>
      <div><dt>الإلزامية المنجزة</dt><dd>${journey.requiredDone} من ${journey.requiredTotal}</dd></div>
    </dl>
    <p class="form-hint">${escapeHtml(sourceNote)}</p>
  </section>

  ${flashBox(flash)}

  ${journey.steps.map((step) => renderStep(step, journey.statuses)).join('')}
</div>`;

  return renderLayout({
    title: 'مسار البحث',
    subtitle: `${journey.title} — ${journey.done}/${journey.total} خطوة منجزة`,
    area: 'app',
    activeKey: 'journey',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}
