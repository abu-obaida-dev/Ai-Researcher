import { formatDateTime } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة الشات (1F): صندوق دردشة بملء الشاشة + قائمة المحادثات داخل السايدبار.
 *
 * قرارات التصميم:
 * - بلا ترويسة صفحة (pageHead:false) وبلا هيدر للكارت: أقصى مساحة لمربع الدردشة.
 * - زر «محادثة جديدة» في أعلى قائمة المحادثات بالسايدبار (لا مكان له داخل الكارت).
 * - زر الإرسال بجانب مربع الكتابة مباشرة (وليس تحته).
 * - بلا اقتراحات داخل الكارت: «محادثة جديدة» تبدأ محادثة نظيفة.
 * - الحذف لا يلمس التوكنز: الاستهلاك يُسجَّل في usage_logs وقت كل رسالة،
 *   وحذف المحادثة يحذف المحادثة ورسائلها فقط (لا رصيد ولا سجل استهلاك).
 */

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

/** تصريف عربي مبسّط لعدد الرسائل: 1 → رسالة واحدة · 2 → رسالتان · 3-10 → N رسائل · غير ذلك → N رسالة. */
function messageCountLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return 'رسالة واحدة';
  if (n === 2) return 'رسالتان';
  if (n >= 3 && n <= 10) return `${n} رسائل`;
  return `${n} رسالة`;
}

/**
 * قائمة المحادثات — تُدرَج في أعلى قائمة السايدبار (مثل ChatGPT/Claude).
 * زر «محادثة جديدة» في الأعلى، ولكل محادثة زر حذف مستقل.
 */
function renderConversations(conversations, activeId) {
  const list = conversations.length
    ? `<ul class="chat-list">
  ${conversations
    .map(
      (item) => `<li class="chat-item${item.id === activeId ? ' is-active' : ''}">
    <a href="/chat?c=${escapeHtml(item.id)}" title="${escapeHtml(item.title || 'محادثة')}">
      <b>${escapeHtml(item.title || 'محادثة')}</b>
      <span class="muted">${escapeHtml(messageCountLabel(item.messages_count))} · ${escapeHtml(formatDateTime(item.updated_at))}</span>
    </a>
    <form method="post" action="/chat/${escapeHtml(item.id)}/delete" class="chat-del">
      <button class="chat-del-btn" type="submit" title="حذف المحادثة" aria-label="حذف المحادثة">${icon('trash', 'icon-sm')}</button>
    </form>
  </li>`
    )
    .join('')}
</ul>`
    : '<p class="chat-side-empty">لا محادثات محفوظة بعد.</p>';

  return `<div class="chat-nav">
  <a class="btn btn-primary btn-block" href="/chat">${icon('plus', 'icon-sm')} محادثة جديدة</a>
  ${list}
  <p class="chat-side-note">حذف المحادثة لا يُرجِع التوكنز المستهلكة.</p>
</div>`;
}

/** صفحة الشات كاملة. */
export function renderChatPage({
  account,
  unread = 0,
  conversation = null,
  conversations = [],
  stepKey = '',
  stepName = '',
  prefill = '',
  providers = [],
  flash = null
}) {
  const flashHtml = flash
    ? flash.type === 'error'
      ? `<div class="alert chat-flash">${escapeHtml(flash.message)}</div>`
      : `<div class="notice chat-flash">${escapeHtml(flash.message)}</div>`
    : '';

  const providerWarning = providers.length
    ? ''
    : `<div class="alert chat-flash"><b>لا يوجد مزوّد ذكاء اصطناعي مفعّل.</b> أضف أحد المفاتيح <code>OPENROUTER_API_KEY</code> أو <code>GEMINI_API_KEY</code> أو <code>GROK_API_KEY</code> في ملف <code>.env</code> ثم أعد تشغيل الخادم.</div>`;

  const stepContext = stepKey
    ? `<div class="chat-context">${icon('clipboard', 'icon-sm')} <span>السياق: ${escapeHtml(
        stepName || 'خطوة من مسار البحث'
      )}</span><a href="/chat">إزالة</a></div>`
    : '';

  const messagesHtml = conversation?.messages?.length
    ? conversation.messages.map(renderMessage).join('')
    : `<div class="chat-welcome">
  ${icon('sparkles')}
  <p>ابدأ بسؤال واحد واضح — المنهج، أو الموضوع، أو فصل تريد مراجعته.</p>
</div>`;

  const body = `<section class="card chat-card">
  ${providerWarning}
  ${flashHtml}
  ${stepContext}
  <div class="chat-body" id="messages">${messagesHtml}</div>

  <form class="chat-composer" method="post" action="/chat">
    <input type="hidden" name="conversation_id" value="${escapeHtml(conversation?.id || '')}" />
    <input type="hidden" name="step" value="${escapeHtml(stepKey)}" />
    <textarea id="message" name="message" rows="1" required maxlength="8000"
      placeholder="اكتب رسالتك إلى المشرف الذكي…"
      aria-label="رسالتك إلى المشرف الذكي">${escapeHtml(prefill)}</textarea>
    <button class="btn btn-primary chat-send" type="submit" title="إرسال" aria-label="إرسال">${icon('send')}</button>
  </form>
</section>`;

  return renderLayout({
    title: 'المشرف الذكي',
    // بلا ترويسة صفحة: أقصى مساحة لمربع الدردشة
    pageHead: false,
    area: 'app',
    activeKey: 'chat',
    account,
    unread,
    scripts: ['/js/chat-auto-scroll.js', '/js/app-shell.js'],
    // المحادثات جزء من قائمة السايدبار نفسه (أعلى أدوات البحث)
    navTop: renderConversations(conversations, conversation?.id || ''),
    body
  });
}
