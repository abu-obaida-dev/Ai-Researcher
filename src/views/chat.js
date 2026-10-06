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
 * - الحذف لا يلمس النقاط: الاستهلاك يُسجَّل في usage_logs وقت كل رسالة،
 *   وحذف المحادثة يحذف المحادثة ورسائلها فقط (لا رصيد ولا سجل استهلاك).
 */

/**
 * فقاعة رسالة واحدة (لون حسب الدور) مع الوقت.
 * **لا نعرض اسم الموديل** للباحث — ما يهمه هو الإجابة، لا تفاصيل المزوّد.
 * (يُحفظ الموديل في قاعدة البيانات للتشخيص والمراجعة فنيا.)
 */
function renderMessage(message) {
  const isUser = message.role === 'user';

  return `<div class="bubble ${isUser ? 'bubble-user' : 'bubble-ai'}">
  <p class="bubble-text">${escapeHtml(message.content)}</p>
  <p class="bubble-meta">${isUser ? 'أنت' : 'المشرف الذكي'} · ${escapeHtml(formatDateTime(message.created_at))}</p>
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
  <p class="chat-side-note">حذف المحادثة لا يُرجِع النقاط المستهلكة.</p>
</div>`;
}

/** شريط الوضع: إرشاد عادي ⇄ مناقشة تدريبية، مع عدّاد أسئلة المناقشة. */
function renderModeBar(conversation) {
  if (!conversation?.id) return '';

  const isDefense = conversation.mode === 'defense';
  const state = conversation.defense_state || {};
  const asked = Number(state.asked) || 0;

  const toggle = isDefense
    ? `<form method="post" action="/chat/${escapeHtml(conversation.id)}/mode" class="inline-form">
    <input type="hidden" name="mode" value="normal" />
    <button class="btn btn-quiet btn-sm" type="submit">${icon('message', 'icon-sm')} إنهاء المناقشة</button>
  </form>`
    : `<form method="post" action="/chat/${escapeHtml(conversation.id)}/mode" class="inline-form">
    <input type="hidden" name="mode" value="defense" />
    <button class="btn btn-quiet btn-sm" type="submit">${icon('clipboard', 'icon-sm')} ابدأ مناقشة</button>
  </form>`;

  return `<div class="chat-modebar${isDefense ? ' is-defense' : ''}">
  <span>${isDefense ? `${icon('clipboard', 'icon-sm')} وضع المناقشة${asked ? ` — ${asked} سؤال` : ''}` : `${icon('sparkles', 'icon-sm')} وضع الإرشاد`}</span>
  ${toggle}
</div>`;
}

/**
 * إرفاق ملفات مع الرسالة: مربّعات اختيار **داخل نموذج الإرسال** (كانت خارج النموذج
 * فلا تصل المشرف ولا واحدة)، مع وسم «يُقرأ/غير مقروء» لكل صيغة.
 */
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

  return `<div class="chat-attach" id="chat-attach">
  <span class="chat-attach-label">${icon('clipboard', 'icon-sm')} أرفق مع رسالتك:</span>
  ${rows}
  <span class="chat-attach-hint">اختر ما تريد قراءته في هذه الرسالة · حتى ٣ ملفات · PDF و Word و txt و Excel (الصور لا تُقرأ نصياً)</span>
</div>`;
}

/**
 * نتائج أداة المراجع — تظهر تحت آخر ردّ: بيانات الاستشهاد كاملة + رابط
 * المصدر + رابط النسخة المفتوحة، وزر لإضافتها إلى «مراجعي» بضغطة واحدة.
 */
function renderReferencesFound(conversation) {
  const items = Array.isArray(conversation?.references_found) ? conversation.references_found : [];
  if (!items.length) return '';

  const rows = items
    .map((item) => {
      const meta = [item.authorText || 'بلا مؤلف محدد', item.year || '', item.venue || '', item.doi ? `DOI: ${item.doi}` : '']
        .filter(Boolean)
        .join(' · ');

      // عنصر المكتبة: يفتح داخل المنصة (معاينة/تحميل) — عنصر الويب: رابط خارجي.
      if (item.kind === 'library') {
        const open = [
          item.hasFile
            ? `<a href="/library/${escapeHtml(item.id)}/file?inline=1" target="_blank" rel="noopener">${icon(
                'book',
                'icon-sm'
              )} اقرأ الكتاب</a>
               <a href="/library/${escapeHtml(item.id)}/file">${icon('download', 'icon-sm')} تحميل</a>`
            : '',
          // رابط المصدر في صفحة المراجع يبقى متاحاً دائماً (مجلّة · أرXiv · رابط حرّ).
          item.externalUrl
            ? `<a href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener">المصدر ↗</a>`
            : ''
        ]
          .filter(Boolean)
          .join(' ');

        return `<li class="ref-found is-library">
    <b>${escapeHtml(item.title)}</b>
    <span class="ref-found-meta">${escapeHtml(meta)}${item.hasFile ? ' · متاح داخل المنصة' : ''}${
      item.fromLink ? ' · بيانات المجلة مقروءة من رابط المصدر' : ''
    }</span>
    <span class="ref-found-links">
      ${open}
      <form method="post" action="/references" class="inline-form">
        <input type="hidden" name="library_item_id" value="${escapeHtml(item.id)}" />
        <button class="btn btn-sm" type="submit">${icon('plus', 'icon-sm')} إلى مراجعي</button>
      </form>
    </span>
  </li>`;
      }

      const link = item.pdfUrl || item.url || '';

      return `<li class="ref-found">
    <b>${escapeHtml(item.title)}</b>
    <span class="ref-found-meta">${escapeHtml(meta)}</span>
    <span class="ref-found-links">
      ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${item.pdfUrl ? 'تحميل PDF' : 'فتح المصدر'} ↗</a>` : ''}
      <form method="post" action="/references/web" class="inline-form">
        <input type="hidden" name="title" value="${escapeHtml(item.title)}" />
        <input type="hidden" name="authors" value="${escapeHtml(item.authorText || '')}" />
        <input type="hidden" name="year" value="${escapeHtml(String(item.year || ''))}" />
        <input type="hidden" name="venue" value="${escapeHtml(item.venue || '')}" />
        <input type="hidden" name="doi" value="${escapeHtml(item.doi || '')}" />
        <input type="hidden" name="url" value="${escapeHtml(item.url || '')}" />
        <button class="btn btn-sm" type="submit">${icon('plus', 'icon-sm')} إلى مراجعي</button>
      </form>
    </span>
  </li>`;
    })
    .join('\n  ');

  return `<details class="chat-refs" id="chat-refs">
  <summary>${icon('book', 'icon-sm')} مراجع جاهزة (${items.length}) — اضغط للعرض</summary>
  <p class="chat-refs-hint">بياناتها كما في المصدر؛ وما عليه شريط أخضر فهو قابل للقراءة والتحميل داخل المنصة الآن.</p>
  <ul class="ref-found-list">${rows}</ul>
</details>`;
}

/**
 * بطاقة مراجعة اكتمال الخطوة داخل الحوار: تظهر بعد آخر رد إن وُجدت بطاقة
 * معلّقة (conversations.pending_review). بلا جافاسكربت: «تعديل» يعيد POST
 * يفتح الحقول، و«حفظ» يُنجز الخطوة فعلاً، و«إلغاء» يمسح البطاقة فقط —
 * ولمس المسار كله يتوقف عند زر الحفظ.
 */
function renderStepReviewCard(conversation) {
  const card = conversation?.pending_review;
  if (!card?.stepKey || !Array.isArray(card.fields)) return '';

  const action = `/chat/${encodeURIComponent(conversation.id)}/step-review`;
  const hidden = `<input type="hidden" name="step" value="${escapeHtml(conversation.step_key || card.stepKey)}" />`;
  const head = `<header class="sr-head">${icon('check', 'icon-sm')} <b>مراجعة اكتمال الخطوة</b> — ${escapeHtml(
    card.stepTitle || ''
  )}</header>`;
  const hint = `<p class="sr-hint">هذه بيانات استخرجناها من حديثك مع المشرفة. لا يُحتسب شيء في مسارك إلا بعد الضغط على «حفظ وإتمام الخطوة».</p>`;

  let content;
  if (card.editing) {
    content = `<form class="sr-form" method="post" action="${action}">
  ${hidden}
  ${card.fields
    .map(
      (field) => `<label class="sr-field">
    <span>${escapeHtml(field.label)}</span>
    <input type="text" name="f_${escapeHtml(field.key)}" value="${escapeHtml(field.value || '')}" maxlength="300" required />
  </label>`
    )
    .join('\n  ')}
  <div class="sr-actions">
    <button class="btn btn-primary btn-sm" type="submit" name="action" value="save">حفظ وإتمام الخطوة</button>
    <button class="btn btn-quiet btn-sm" type="submit" name="action" value="cancel">إلغاء المراجعة</button>
  </div>
</form>`;
  } else {
    content = `<dl class="sr-list">
  ${card.fields
    .map(
      (field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value || '—')}</dd></div>`
    )
    .join('\n  ')}
</dl>
<div class="sr-actions">
  <form method="post" action="${action}" class="inline-form">
    ${hidden}<input type="hidden" name="action" value="save" />
    <button class="btn btn-primary btn-sm" type="submit">حفظ وإتمام الخطوة</button>
  </form>
  <form method="post" action="${action}" class="inline-form">
    ${hidden}<input type="hidden" name="action" value="edit" />
    <button class="btn btn-sm" type="submit">تعديل</button>
  </form>
  <form method="post" action="${action}" class="inline-form">
    ${hidden}<input type="hidden" name="action" value="cancel" />
    <button class="btn btn-quiet btn-sm" type="submit">إلغاء</button>
  </form>
</div>`;
  }

  return `<section class="step-review" id="step-review">${head}${hint}${content}</section>`;
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
  attachableFiles = [],
  providers = [],
  flash = null,
  profileNotice = ''
}) {
  const flashHtml = flash
    ? flash.type === 'error'
      ? `<div class="alert chat-flash">${escapeHtml(flash.message)}</div>`
      : `<div class="notice chat-flash">${escapeHtml(flash.message)}</div>`
    : '';

  // رسالة ذكية (وليست منعاً): تشرح ما الذي ينقص لتفعيل الإشراف المخصص مع رابط مباشر
  const profileNoticeHtml = profileNotice
    ? `<div class="notice chat-flash"><b>ملفك البحثي غير مكتمل.</b> ${profileNotice}</div>`
    : '';

  const providerWarning = providers.length
    ? ''
    : `<div class="alert chat-flash"><b>لا يوجد مزوّد ذكاء اصطناعي مفعّل.</b> أضف أحد المفاتيح <code>OPENROUTER_API_KEY</code> أو <code>GROQ_API_KEY</code> أو <code>GEMINI_API_KEY</code> في ملف <code>.env</code> ثم أعد تشغيل الخادم.</div>`;

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
  ${profileNoticeHtml}
  ${flashHtml}
  ${stepContext}
  ${renderModeBar(conversation)}
  <div class="chat-body" id="messages">${messagesHtml}${renderStepReviewCard(conversation)}</div>

  ${renderReferencesFound(conversation)}

  <form class="chat-composer" method="post" action="/chat">
    <input type="hidden" name="conversation_id" value="${escapeHtml(conversation?.id || '')}" />
    <input type="hidden" name="step" value="${escapeHtml(stepKey)}" />
    <div class="chat-composer-row">
      <textarea id="message" name="message" rows="1" required maxlength="8000"
        placeholder="${conversation?.mode === 'defense' ? 'اكتب إجابتك…' : 'اكتب رسالتك إلى المشرف الذكي…'}"
        aria-label="رسالتك إلى المشرف الذكي">${escapeHtml(prefill)}</textarea>
      <button class="btn btn-primary chat-send" type="submit" title="إرسال" aria-label="إرسال">${icon('send')}</button>
    </div>
    ${renderAttachRow(attachableFiles)}
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
    // لا سكرول في الصفحة: الشات يملأ ما تبقى من الشاشة والتمرير داخل صندوقه
    fitViewport: true,
    scripts: ['/js/chat-auto-scroll.js', '/js/app-shell.js'],
    // سجل الجلسات أسفل رابط «المشرف الذكي» داخل نفس القائمة
    navBottom: renderConversations(conversations, conversation?.id || ''),
    body
  });
}
