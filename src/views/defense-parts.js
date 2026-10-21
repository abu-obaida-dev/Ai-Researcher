import { formatDateTime } from './format.js';
import { icon } from './icons.js';
import { escapeHtml } from './layout.js';

/** اجزاء صفحة المناقشة المستقلة: السجل + شريط الحالة + رفع البحث. */

export function questionCountLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return 'سؤال واحد';
  if (n === 2) return 'سؤالان';
  if (n >= 3 && n <= 10) return `${n} اسئلة`;
  return `${n} سؤالا`;
}

/**
 * صيغة العدّاد مع السقف: «سؤال ٣ من ٨». بلا سقف نكتفي بالعدد.
 */
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
  const parts = Array.isArray(progress?.parts) ? progress.parts : [];
  if (!parts.length) return '';
  const covered = Array.isArray(progress.coveredParts) ? progress.coveredParts : [];
  const items = parts
    .map((part) => {
      const done = covered.includes(part?.key);
      return `<span class="plan-part${done ? ' is-done' : ''}">${done ? '✓' : '○'} ${escapeHtml(part?.label || part?.key)}</span>`;
    })
    .join('');
  return `<div class="chat-plan" aria-label="خطة المناقشة">${items}</div>`;
}

export function renderThesisBar(conversation, progress) {
  if (!conversation?.id) return '';
  const thesis = progress.thesisFileId ? 'ملف البحث مثبت' : 'بانتظار رفع البحث';
  const finish = !progress.done && progress.thesisFileId
    ? `<form method="post" action="/defense/${escapeHtml(conversation.id)}/finish" class="inline-form"><button class="btn btn-quiet btn-sm" type="submit">${icon('check', 'icon-sm')} انهاء بالتقييم النهائي</button></form>`
    : '';
  // العدّاد مع السقف: «سؤال ٣ من ٨» — يعرضه دائماً بعد تثبيت الملف (حتى قبل
  // أول سؤال) ليعرف الباحث حجم المناقشة، ويُخفى قبل التثبيت.
  const counter = progress.thesisFileId
    ? ` — ${escapeHtml(questionProgressLabel(progress.asked, progress.total))}`
    : '';
  return `<div class="chat-modebar is-defense"><span>${icon('graduation', 'icon-sm')} ${escapeHtml(thesis)}${counter}</span>${finish}</div>`;
}

export function renderThesisCard(conversation, progress, files) {
  // بعد تثبيت البحث وبدء المناقشة: لا بطاقة إطلاقاً — الدردشة ومربع الإجابة فقط.
  if (!conversation?.id || progress.done || progress.thesisFileId) return '';
  const options = (files || []).slice(0, 30).map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.title || f.fileName || 'ملف')}</option>`).join('');
  const form = `<form method="post" action="/defense/${escapeHtml(conversation.id)}/thesis" enctype="multipart/form-data" class="form-card"><div class="field"><label for="thesis-file">ملف جديد (PDF او Word)</label><input id="thesis-file" type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md" /></div>${options ? `<div class="field"><label for="thesis-pick">او اختر من ملفاتك</label><select id="thesis-pick" name="file_id"><option value="">— اختر ملفا —</option>${options}</select></div>` : ''}<div class="form-actions"><button class="btn btn-primary" type="submit">تثبيت وبدء المناقشة</button></div></form>`;
  return `<div class="chat-thesis is-required"><p><b>ارفع ملف البحث اولا.</b> المناقش لن يبدا قبل قراءته كاملا.</p>${form}</div>`;
}
