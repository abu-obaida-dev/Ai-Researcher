import { TOKEN_COSTS } from '../constants.js';
import { formatDateTime, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة الشات (1F): محادثات الباحث مع المشرف الذكي + نموذج الإرسال.
 * بلا JavaScript: نموذج POST عادي يعيد الرسم بعد كل رسالة (نفس estrategia
 * صفحة المسار والملاحظات) — فتعمل حتى مع تعطّل السكربتات.
 */

const CHAT_COST = TOKEN_COSTS.find((item) => item.type === 'chat')?.tokens || 30;

/** اقتراحات سريعة لبداية المحادثة (تحافظ على رصيد الباحث: كل رسالة ٣٠ توكن). */
const STARTERS = [
  'اقترح لي ٥ عناوين بحث في مجالي مع سؤال بحث لكل عنوان',
  'راجع لي منهجي البحثي واذكر نقاط القوة والضعف',
  'كيف أصيغ فجوة بحثية واضحة في مقدمة رسالتي؟',
  'اقترح هيكلاً تفصيلياً لفصل التحليل في رسالتي'
];

/** فقاعة رسالة واحدة (لون حسب الدور) مع الوقت. */
function renderMessage(message) {
  const isUser = message.role === 'user';

  return `<div class="bubble ${isUser ? 'bubble-user' : 'bubble-ai'}">
  <p class="bubble-text">${escapeHtml(message.content)}</p>
  <p class="bubble-meta">${isUser ? 'أنت' : `المشرف الذكي${message.model ? ` · ${escapeHtml(message.model)}` : ''}`} · ${escapeHtml(
    formatDateTime(message.created_at)
  )}</p>
</div>`;
}

/** قائمة محادثات الباحث الجانبية. */
function renderConversations(conversations, activeId) {
  if (!conversations.length) {
    return '<div class="empty">لا محادثات بعد — ابدأ بسؤال من القائمة الجانبية.</div>';
  }

  return `<ul class="chat-list">
  ${conversations
    .map(
      (item) => `<li class="chat-item${item.id === activeId ? ' is-active' : ''}">
    <a href="/chat?c=${escapeHtml(item.id)}">
      <b>${escapeHtml(item.title || 'محادثة')}</b>
      <span class="muted">${item.messages_count} رسالة · ${escapeHtml(formatDateTime(item.updated_at))}</span>
    </a>
    <form method="post" action="/chat/${escapeHtml(item.id)}/delete" class="inline-form">
      <button class="btn btn-quiet" type="submit" aria-label="حذف المحادثة">${icon('trash', 'icon-sm')}</button>
    </form>
  </li>`
    )
    .join('')}
</ul>`;
}

/** صفحة الشات كاملة. */
export function renderChatPage({
  account,
  unread = 0,
  conversation = null,
  conversations = [],
  stepKey = '',
  stepName = '',
  balance = 0,
  providers = [],
  flash = null
}) {
  const flashHtml = flash
    ? flash.type === 'error'
      ? `<div class="alert">${escapeHtml(flash.message)}</div>`
      : `<div class="notice">${escapeHtml(flash.message)}</div>`
    : '';

  const providerWarning = providers.length
    ? ''
    : `<div class="alert"><b>لا يوجد مزوّد ذكاء اصطناعي مفعّل.</b> أضف أحد المفاتيح <code>OPENROUTER_API_KEY</code> أو <code>GEMINI_API_KEY</code> أو <code>GROK_API_KEY</code> في ملف <code>.env</code> ثم أعد تشغيل الخادم.</div>`;

  const stepContext = stepKey
    ? `<p class="form-hint">السياق: ${escapeHtml(stepName || 'خطوة من مسار البحث')} — يمزجه المشرف الذكي في إجابته.</p>`
    : '';

  const messagesHtml = conversation?.messages?.length
    ? conversation.messages.map(renderMessage).join('')
    : `<div class="empty">ابدأ بسؤال من Suggestions أو اكتب سؤالك في الأسفل.</div>`;

  const startersHtml = conversation?.messages?.length
    ? ''
    : `<div class="chips">${STARTERS.map(
        (text) =>
          `<a class="chip" href="/chat?step=${encodeURIComponent(stepKey)}&amp;prompt=${encodeURIComponent(text)}">${escapeHtml(
            text
          )}</a>`
      ).join('')}</div>`;

  const body = `<div class="chat-layout">
  <section class="card chat-main">
    <div class="chat-head">
      <h2>${escapeHtml(conversation?.title || 'محادثة جديدة')}</h2>
      <p class="muted">الرصيد: ${formatNumber(balance)} توكن · تكلفة الرسالة: ${formatNumber(CHAT_COST)} توكن</p>
    </div>

    ${providerWarning}
    ${flashHtml}
    ${stepContext}

    <div class="chat-body" id="messages">${messagesHtml}</div>
    ${startersHtml}

    <form class="chat-form" method="post" action="/chat">
      <input type="hidden" name="conversation_id" value="${escapeHtml(conversation?.id || '')}" />
      <input type="hidden" name="step" value="${escapeHtml(stepKey)}" />
      <div class="field">
        <label for="message">رسالتك إلى المشرف الذكي</label>
        <textarea id="message" name="message" rows="4" required maxlength="8000" placeholder="مثال: أراجع منهج الوصفي في دراستي — هل يناسب سؤال البحث؟"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${icon('send', 'icon-sm')} إرسال</button>
        <a class="btn btn-quiet" href="/chat">${icon('plus', 'icon-sm')} محادثة جديدة</a>
        <span class="muted">يُحفظ سجل المحادثة في حسابك ويظهر في لوحتك.</span>
      </div>
    </form>
  </section>

  <aside class="card chat-side">
    <h3>محادثاتي</h3>
    ${renderConversations(conversations, conversation?.id || '')}
    <div class="chat-side-links">
      <a class="btn btn-quiet" href="/journey">${icon('clipboard', 'icon-sm')} مسار البحث</a>
      <a class="btn btn-quiet" href="/notes">${icon('list', 'icon-sm')} المفكرة</a>
      <a class="btn btn-quiet" href="/files">${icon('paperclip', 'icon-sm')} الملفات</a>
    </div>
  </aside>
</div>`;

  return renderLayout({
    title: 'المشرف الذكي',
    subtitle: 'اسأل عن منهجك أو موضوعك أو فصولك — وسيجيبك بناءً على ملفك ومسارك',
    area: 'app',
    activeKey: 'chat',
    account,
    unread,
    scripts: ['/js/chat-auto-scroll.js', '/js/app-shell.js'],
    body
  });
}

export { CHAT_COST };
