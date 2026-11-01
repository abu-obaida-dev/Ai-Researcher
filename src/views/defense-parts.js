import { formatDateTime } from './format.js';
import { icon } from './icons.js';
import { escapeHtml } from './layout.js';

/** Defense-page components: session list, status bar, and thesis upload. */

export function questionCountLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return 'سؤال واحد';
  if (n === 2) return 'سؤالان';
  if (n >= 3 && n <= 10) return `${n} اسئلة`;
  return `${n} سؤالا`;
}

/** Formats the question counter with its session limit. */
export function questionProgressLabel(asked, total) {
  const n = Number(asked) || 0;
  const max = Number(total) || 0;
  if (!max) return questionCountLabel(n);
  return `سؤال ${n} من ${max}`;
}

export function renderConversations(sessions, activeId) {
  const list = sessions.length
    ? `<ul class="chat-list">${sessions.map((item) => `<li class="chat-item${item.id === activeId ? ' is-active' : ''}">
    <a href="/defense?d=${escapeHtml(item.id)}"><b>${escapeHtml(item.title || 'مناقشة')}</b><span class="muted">${escapeHtml(questionProgressLabel(item.progress.asked, item.progress.total))} · ${escapeHtml(item.progress.stageLabel)} · ${escapeHtml(formatDateTime(item.updatedAt))}</span></a>
    <form method="post" action="/defense/${escapeHtml(item.id)}/delete" class="chat-del"><button class="chat-del-btn" type="submit" title="حذف" aria-label="حذف">${icon('trash', 'icon-sm')}</button></form>
  </li>`).join('')}</ul>`
    : '<p class="chat-side-empty">لا مناقشات بعد.</p>';
  return `<div class="chat-nav"><form method="post" action="/defense/start"><button class="btn btn-primary btn-block" type="submit">${icon('plus', 'icon-sm')} مناقشة جديدة</button></form>${list}<p class="chat-side-note">كل دردشة بملف بحث ثابت.</p></div>`;
}

/**
 * شريط خطة المناقشة: الأجزاء المغطاة (✓) والباقية (○) — يعرض التقدّم
 * ويمنع التكرار: الباحث يرى أن «النتائج» غُطّيت فلا ينتظر سؤالاً عنها.
 */
export function renderDefensePlan(progress) {
  return '';
}

/** Renders the persisted reason when an answer could not be graded. */
export function renderDefenseGradeNotice(progress) {
  const message = {
    insufficient_credits: 'تعذّر تقييم بعض الإجابات بسبب عدم كفاية الرصيد.',
    invalid_grade: 'تعذّر فهم نتيجة تقييم بعض الإجابات.',
    question_not_found: 'تعذّر ربط بعض الإجابات بأسئلتها.',
    persistence_failed: 'تعذّر حفظ بعض نتائج التقييم.',
    provider_failed: 'تعذّرت خدمة الذكاء الاصطناعي أثناء تقييم بعض الإجابات.',
    PROVIDERS_FAILED: 'تعذّرت خدمة الذكاء الاصطناعي أثناء تقييم بعض الإجابات.',
    NO_PROVIDER: 'لم يتوفر مزوّد ذكاء اصطناعي لتقييم بعض الإجابات.'
  }[progress.gradeIssue];
  return message
    ? `<p class="alert chat-flash" role="alert">${escapeHtml(message)} راجع إعدادات المزوّد أو الرصيد.</p>`
    : '';
}

/** Renders answer statistics only after the final report. */
export function renderDefenseStats(progress) {
  if (!progress?.done) return '';
  return `<section class="defense-stats" aria-labelledby="defense-stats-title">
  <h2 id="defense-stats-title">إحصائيات المناقشة</h2>
  <dl class="defense-stats-grid">
    <div><dt>الأسئلة المطروحة</dt><dd>${escapeHtml(progress.asked || 0)}</dd></div>
    <div><dt>إجابات صحيحة</dt><dd>${escapeHtml(progress.correctCount || 0)}</dd></div>
    <div><dt>إجابات صحيحة جزئياً</dt><dd>${escapeHtml(progress.partialCount || 0)}</dd></div>
    <div><dt>إجابات خاطئة</dt><dd>${escapeHtml(progress.wrongCount || 0)}</dd></div>
    <div><dt>أسئلة بلا تقييم أو إجابة</dt><dd>${escapeHtml(progress.ungradedCount || 0)}</dd></div>
  </dl>
</section>`;
}

export function renderThesisBar(conversation, progress) {
  if (!conversation?.id) return '';
  const thesis = progress.thesisFileId ? 'ملف البحث مثبت' : 'بانتظار رفع البحث';
  const finish = !progress.done && progress.thesisFileId
    ? `<form method="post" action="/defense/${escapeHtml(conversation.id)}/finish" class="inline-form"><button class="btn btn-quiet btn-sm" type="submit">${icon('check', 'icon-sm')} انهاء بالتقييم النهائي</button></form>`
    : '';
  // Show the session limit as soon as the thesis is attached.
  const counter = progress.thesisFileId
    ? ` — ${escapeHtml(questionProgressLabel(progress.asked, progress.total))}`
    : '';
  return `<div class="chat-modebar is-defense"><span>${icon('graduation', 'icon-sm')} ${escapeHtml(thesis)}${counter}</span>${finish}</div>`;
}

export function renderThesisCard(conversation, progress, files) {
  // Hide the upload form once the thesis is attached.
  if (!conversation?.id || progress.done || progress.thesisFileId) return '';
  const options = (files || []).slice(0, 30).map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.title || f.fileName || 'ملف')}</option>`).join('');
  const form = `<form method="post" action="/defense/${escapeHtml(conversation.id)}/thesis" enctype="multipart/form-data" class="form-card defense-thesis-form"><div class="field"><label for="thesis-file">ملف جديد (PDF او Word)</label><input id="thesis-file" type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md" /></div>${options ? `<div class="field"><label for="thesis-pick">او اختر من ملفاتك</label><select id="thesis-pick" name="file_id"><option value="">— اختر ملفا —</option>${options}</select></div>` : ''}<div class="form-actions"><button class="btn btn-primary defense-thesis-submit" type="submit">تثبيت وبدء المناقشة</button></div><p class="defense-upload-status" data-upload-status role="status" aria-live="polite" hidden>جارٍ تثبيت الملف وقراءة البحث وتجهيز المناقشة. قد يستغرق ذلك بعض الوقت؛ اترك الصفحة مفتوحة.</p></form>`;
  return `<div class="chat-thesis is-required"><p><b>ارفع ملف البحث اولا.</b> المناقش لن يبدا قبل قراءته كاملا.</p>${form}</div>`;
}
