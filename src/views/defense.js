import { formatDateTime, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';
import { defenseChecklist } from '../services/defense.js';

/**
 * صفحة المناقشة (خدمة defense): محاكاة مناقشة حقيقية بعد انتهاء البحث.
 *
 * - بلا ترويسة صفحة زائدة: شريط مراحل + بطاقة الجلسة + مربع الإجابة.
 * - «ابدأ محاكاة» ينشئ محادثة (mode='defense')، وكل إجابة تُحسب في عدّاد الأسئلة.
 * - بعد انتهاء الأسئلة يظهر التقييم النهائي ونقاط التحضير.
 */

/** فقاعة رسالة واحدة (نفس هوية صندوق الدردشة). */
function renderMessage(message) {
  const isUser = message.role === 'user';
  return `<div class="bubble ${isUser ? 'bubble-user' : 'bubble-ai'}">
  <p class="bubble-text">${escapeHtml(message.content)}</p>
  <p class="bubble-meta">${isUser ? 'أنت' : 'لجنة المناقشة'} · ${escapeHtml(formatDateTime(message.created_at))}</p>
</div>`;
}

/** شريط مراحل المناقشة مع تمييز المرحلة الحالية (وما قبلها كمراحل اجتازها الباحث). */
function renderStages(progress) {
  const currentIndex = (progress.stages || []).findIndex((stage) => stage.key === progress.stageKey);
  const chips = (progress.stages || [])
    .map((stage, index) => {
      const passed = progress.done || (currentIndex > -1 && index < currentIndex);
      const current = !progress.done && index === currentIndex;
      return `<span class="chip${current ? ' is-active' : passed ? ' is-done' : ''}">${escapeHtml(stage.label)}</span>`;
    })
    .join(' ');

  return `<div class="chips mt-12">${chips}</div>`;
}

/** بطاقة معلومات الجلسة: المرحلة، العدّاد، وبطاقة «ابدأ». */
function renderSessionCard(conversation, progress) {
  const meter = Math.round((progress.asked / progress.total) * 100);

  if (!conversation) {
    return `<section class="card">
      <h2>ابدأ محاكاة مناقشة</h2>
      <p class="muted">جلسة محاكاة يسألك فيها «لجنة المناقشة» عن بحثك سؤالاً بعد سؤال، ثم يقدّم تقييماً نهائياً ونقاط ضعف.</p>
      <div class="form-actions">
        <form method="post" action="/defense/start"><button class="btn btn-primary" type="submit">ابدأ جلسة مناقشة</button></form>
      </div>
    </section>`;
  }

  return `<section class="card">
    <div class="lib-section-head">
      <h2>${escapeHtml(conversation.title || 'محاكاة مناقشة')}</h2>
      <span class="muted">${escapeHtml(progress.stageLabel)} · ${formatNumber(progress.asked)}/${formatNumber(progress.total)}</span>
    </div>
    <p class="muted">${escapeHtml(progress.stageHint)}</p>
    <div class="meter"><i style="width:${meter}%"></i></div>
    ${renderStages(progress)}
    <div class="lib-actions">
      <form method="post" action="/defense/start"><button class="btn btn-sm" type="submit">جلسة جديدة</button></form>
    </div>
  </section>`;
}

/** قائمة جلسات المحاكاة السابقة. */
function renderSessionList(sessions, activeId) {
  if (!sessions.length) return '';
  return `<section class="card">
    <h2>جلساتك السابقة</h2>
    <ul class="chat-list">
      ${sessions
        .map(
          (item) => `<li class="chat-item${item.id === activeId ? ' is-active' : ''}">
      <a href="/defense?d=${escapeHtml(item.id)}">
        <b>${escapeHtml(item.title || 'محاكاة')}</b>
        <span class="muted">${formatNumber(item.progress.asked)}/${formatNumber(item.progress.total)} سؤال · ${escapeHtml(item.progress.stageLabel)} · ${escapeHtml(
      formatDateTime(item.updatedAt)
    )}</span>
      </a>
      <form method="post" action="/defense/${escapeHtml(item.id)}/delete" class="chat-del">
        <button class="chat-del-btn" type="submit" title="حذف المحاكاة" aria-label="حذف المحاكاة">${icon('trash', 'icon-sm')}</button>
      </form>
    </li>`
        )
        .join('')}
    </ul>
  </section>`;
}

/** بطاقة الإجابة: مربع كتابة + زر الإرسال، أو ملاحظة انتهاء المحاكاة. */
function renderAnswerCard(conversation, progress, error) {
  if (!conversation) {
    return `<section class="card"><div class="empty">ابدأ جلسة مناقشة لتظهر هنا أسئلة اللجنة.</div></section>`;
  }

  if (progress.done) {
    return `<section class="card">
      <h2>انتهت المحاكاة</h2>
      <div class="notice">وصلت إلى نهاية الأسئلة. اقرأ التقييم النهائي في المحادثة أعلاه، وجرّب جلسة جديدة بعد تحسين بحثك.</div>
    </section>`;
  }

  return `<section class="card">
    ${error ? `<div class="alert">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/defense/${escapeHtml(conversation.id)}/answer" class="form-card">
      <div class="field">
        <label for="defense-answer">إجابتك (الاستعداد: ${escapeHtml(progress.stageHint)})</label>
        <textarea id="defense-answer" name="answer" rows="4" maxlength="3000" required placeholder="اكتب إجابتك بأسلوب مناقشة حقيقي: breve في البداية، ثم التفاصيل مع التبرير."></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${icon('send', 'icon-sm')} أرسل الإجابة</button>
      </div>
    </form>
  </section>`;
}

/** صفحة المناقشة: جلسات + محادثة + إجابة. */
export function renderDefensePage({ account = null, unread = 0, conversation = null, sessions = [], progress = null, error = '' }) {
  const current = progress || defenseChecklist({ done: false });

  const body = `
  <div class="grid">
    <div>
      ${renderSessionCard(conversation, current)}
      ${renderAnswerCard(conversation, current, error)}
    </div>
    <div>
      ${renderSessionList(sessions, conversation?.id)}
      <section class="card">
        <h2>قبل المناقشة</h2>
        <ul class="muted">${defenseChecklist(current).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>
    </div>
  </div>`;

  return renderLayout({
    title: 'المناقشة والتدريب عليها',
    subtitle: 'محاكاة مناقشة حقيقية بعد انتهاء البحث — أسئلة متدرجة ثم تقييم',
    area: 'app',
    activeKey: 'defense',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}