import { formatDateTime } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة «المعلم» (/assistant): مساعد تعليمي مستقل عن المشرف الذكي.
 *
 * قرارات التصميم (بنفس نمط صفحة الشات):
 * - بلا ترويسة صفحة: أقصى مساحة لمربع الدردشة.
 * - سجل محادثات المعلم داخل السايدبار (أسفل رابط المشرف الذكي).
 * - إرفاق الملفات داخل نموذج الإرسال (للترجمة) — نفس آلية الشات.
 * - إعادة استخدام chat-send.js كما هو (fetch + قطع محدّثة بلا إعادة تحميل).
 */

/** فقاعة رسالة واحدة (المعلم هو الطرف الآخر دائماً). */
function renderMessage(message) {
  const isUser = message.role === 'user';
  return `<div class="bubble ${isUser ? 'bubble-user' : 'bubble-ai'}">
  <p class="bubble-text">${escapeHtml(message.content)}</p>
  <p class="bubble-meta">${isUser ? 'أنت' : 'المعلم'} · ${escapeHtml(formatDateTime(message.created_at))}</p>
</div>`;
}

/** تصريف عربي مبسّط لعدد الرسائل. */
function messageCountLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return 'رسالة واحدة';
  if (n === 2) return 'رسالتان';
  if (n >= 3 && n <= 10) return `${n} رسائل`;
  return `${n} رسالة`;
}

/** قائمة محادثات المعلم — تُدرَج في أعلى قائمة السايدبار. */
function renderConversations(conversations, activeId) {
  const list = conversations.length
    ? `<ul class="chat-list">
  ${conversations
    .map(
      (item) => `<li class="chat-item${item.id === activeId ? ' is-active' : ''}">
    <a href="/assistant?c=${escapeHtml(item.id)}" title="${escapeHtml(item.title || 'محادثة')}">
      <b>${escapeHtml(item.title || 'محادثة')}</b>
      <span class="muted">${escapeHtml(messageCountLabel(item.messages_count))} · ${escapeHtml(formatDateTime(item.updated_at))}</span>
    </a>
    <form method="post" action="/assistant/${escapeHtml(item.id)}/delete" class="chat-del">
      <button class="chat-del-btn" type="submit" title="حذف المحادثة" aria-label="حذف المحادثة">${icon('trash', 'icon-sm')}</button>
    </form>
  </li>`
    )
    .join('')}
</ul>`
    : '<p class="chat-side-empty">لا محادثات محفوظة بعد.</p>';

  return `<div class="chat-nav">
  <a class="btn btn-primary btn-block" href="/assistant">${icon('plus', 'icon-sm')} محادثة جديدة</a>
  ${list}
  <p class="chat-side-note">المعلم مساعد تعليمي مستقل — لا يعدّل مسار بحثك ولا يكتب بحثك بدلاً منك.</p>
</div>`;
}

/** إرفاق ملفات مع الرسالة (للترجمة) — قائمة منسدلة مطويّة فوق صندوق الكتابة،
 *  تظهر فقط عند وجود ملفات (نفس بنية الإرفاق في الشات). */
function renderAttachRow(files = []) {
  if (!files.length) return '';

  const rows = files
    .map((file) => {
      const readable = /\.(txt|md|csv|json|xlsx|xls|docx|pdf)$/i.test(file.fileName || '');
      return `<label class="chat-attach-chip" title="${escapeHtml(file.fileName)}">
    <input type="checkbox" name="file_ids" value="${escapeHtml(file.id)}" />
    <span class="attach-name">${escapeHtml(file.fileName)}</span>
    <span class="attach-tag ${readable ? 'is-ok' : 'is-off'}">${readable ? 'يُقرأ' : 'غير مقروء'}</span>
  </label>`;
    })
    .join('\n  ');

  return `<details class="chat-attach" id="chat-attach">
  <summary class="chat-attach-sum">${icon('paperclip', 'icon-sm')} أرفق ملفاً <span class="attach-total">${files.length}</span><span class="attach-picked">✓</span></summary>
  <div class="chat-attach-panel">
  ${rows}
  <span class="chat-attach-hint">اختر الملف ثم اكتب «ترجم» · حتى ٣ ملفات · PDF و Word و txt و Excel (الصور لا تُقرأ نصياً)</span>
  </div>
</details>`;
}

/** نتائج البحث — تظهر تحت آخر رد: بيانات المصدر ورابط فتحه/تحميله. */
function renderSourcesFound(conversation) {
  const items = Array.isArray(conversation?.sources_found) ? conversation.sources_found : [];
  if (!items.length) return '';

  const rows = items
    .map((item) => {
      const meta = [item.authorText || 'بلا مؤلف محدد', item.year || '', item.venue || '', item.doi ? `DOI: ${item.doi}` : '']
        .filter(Boolean)
        .join(' · ');

      if (item.kind === 'library') {
        const open = [
          item.hasFile
            ? `<a href="/library/${escapeHtml(item.id)}/file?inline=1" target="_blank" rel="noopener">${icon('book', 'icon-sm')} اقرأ الكتاب</a>
               <a href="/library/${escapeHtml(item.id)}/file">${icon('download', 'icon-sm')} تحميل</a>`
            : '',
          item.externalUrl ? `<a href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener">المصدر ↗</a>` : ''
        ]
          .filter(Boolean)
          .join(' ');

        return `<li class="ref-found is-library">
    <b>${escapeHtml(item.title)}</b>
    <span class="ref-found-meta">${escapeHtml(meta)}${item.hasFile ? ' · متاح داخل المنصة' : ''}</span>
    <span class="ref-found-links">${open}</span>
  </li>`;
      }

      const link = item.pdfUrl || item.url || '';
      return `<li class="ref-found">
    <b>${escapeHtml(item.title)}</b>
    <span class="ref-found-meta">${escapeHtml(meta)}</span>
    <span class="ref-found-links">${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${item.pdfUrl ? 'تحميل PDF' : 'فتح المصدر'} ↗</a>` : ''}</span>
  </li>`;
    })
    .join('\n  ');

  return `<details class="chat-refs" id="chat-refs">
  <summary>${icon('book', 'icon-sm')} مصادر البحث (${items.length}) — اضغط للعرض</summary>
  <p class="chat-refs-hint">بياناتها كما في المصادر نفسها؛ المكتبة قابلة للقراءة والتحميل داخل المنصة.</p>
  <ul class="ref-found-list">${rows}</ul>
</details>`;
}

/**
 * قطع تحديث الصفحة بعد إرسال رسالة (يستبدلها chat-send.js في أماكنها):
 * صندوق الرسائل + لوحة المصادر + قائمة المحادثات في السايدبار.
 */
export function renderAssistantUpdate({ conversation = null, conversations = [] }) {
  const messagesHtml = conversation?.messages?.length
    ? conversation.messages.map(renderMessage).join('')
    : '';

  return {
    messagesHtml,
    refsHtml: renderSourcesFound(conversation),
    conversationsHtml: renderConversations(conversations, conversation?.id || '')
  };
}

/** أزرار مهام سريعة (تملأ مربع الرسالة مسبقاً عبر ?prompt=). */
function renderTaskButtons() {
  const tasks = [
    { prompt: 'أريد أن أتعلم كيف أهيكل بحثي خطوة بخطوة — من أين أبدأ؟', label: 'كيف أهيكل بحثي؟' }
  ];

  return `<div class="chat-tasks">
  ${tasks
    .map(
      (task) =>
        `<a class="btn btn-quiet btn-sm" href="/assistant?prompt=${encodeURIComponent(task.prompt)}">${escapeHtml(task.label)}</a>`
    )
    .join('\n  ')}
  <span class="chat-tasks-hint">المعلم لا يبحث في المكتبة الخارجية ولا مكتبة المنصة — يلخّص أو يترجم فقط ما ترفقه أنت من ملف أو مرجع.</span>
</div>`;
}

/** صفحة المعلم كاملة. */
export function renderAssistantPage({
  account,
  unread = 0,
  conversation = null,
  conversations = [],
  prefill = '',
  attachableFiles = [],
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
    : `<div class="alert chat-flash"><b>لا يوجد مزوّد ذكاء اصطناعي مفعّل.</b> أضف مفتاح <code>GROQ_API_KEY</code> في ملف <code>.env</code> ثم أعد تشغيل الخادم.</div>`;

  const messagesHtml = conversation?.messages?.length
    ? conversation.messages.map(renderMessage).join('')
    : `<div class="chat-welcome">
  ${icon('sparkles')}
  <p>أنا المعلم — أساعدك تفهم كيف تبني بحثك بنفسك، وأترجم ملفاتك، وألخّص فقط ما ترفقه أنت من ملف أو مرجع.</p>
  ${renderTaskButtons()}
</div>`;

  const body = `<section class="card chat-card">
  ${providerWarning}
  ${flashHtml}
  <div class="chat-body" id="messages">${messagesHtml}${renderTaskButtons()}</div>

  ${renderSourcesFound(conversation)}

  <form class="chat-composer" method="post" action="/assistant">
    <input type="hidden" name="conversation_id" value="${escapeHtml(conversation?.id || '')}" />
    <div class="chat-composer-row">
      <textarea id="message" name="message" rows="1" required maxlength="8000"
        placeholder="اكتب سؤالك للمعلم… (تعليم · ترجمة · تلخيص)"
        aria-label="رسالتك إلى المعلم">${escapeHtml(prefill)}</textarea>
      <button class="btn btn-primary chat-send" type="submit" title="إرسال" aria-label="إرسال">${icon('send')}</button>
    </div>
    ${renderAttachRow(attachableFiles)}
  </form>
</section>`;

  return renderLayout({
    title: 'المعلم',
    subtitle: 'مساعد تعليمي: يعلّمك تهيكل بحثك · يترجم ملفاتك · يلخّص من المكتبة',
    pageHead: false,
    area: 'app',
    activeKey: 'assistant',
    account,
    unread,
    fitViewport: true,
    scripts: ['/js/chat-auto-scroll.js', '/js/chat-send.js', '/js/app-shell.js'],
    navBottom: renderConversations(conversations, conversation?.id || ''),
    body
  });
}

