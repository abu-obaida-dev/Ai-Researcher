import { formatDateTime } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';
import { renderThesisBar, renderThesisCard, renderConversations, renderDefensePlan } from './defense-parts.js';

/** صفحة /defense: دردشة بملء الشاشة + السجل في السايدبار (نمط المشرف والمعلم). */
function renderMessage(message) {
  const isUser = message.role === 'user';
  // رسالة نظام (كإشعار تثبيت ملف البحث): صيغة مصغّرة متمركزة لا تشبه حوار المناقِش.
  if (message.role === 'system') {
    return `<div class="bubble bubble-system">
  <p class="bubble-text">${escapeHtml(message.content)}</p>
</div>`;
  }
  return `<div class="bubble ${isUser ? 'bubble-user' : 'bubble-ai'}">
  <p class="bubble-text">${escapeHtml(message.content)}</p>
  <p class="bubble-meta">${isUser ? 'انت' : 'المناقش'} · ${escapeHtml(formatDateTime(message.created_at))}</p>
</div>`;
}

export function renderDefensePage({ account = null, unread = 0, conversation = null, sessions = [], progress = null, files = [], flash = null }) {
  const current = progress || { done: false, asked: 0, stageLabel: '', stageHint: '', thesisFileId: null };
  const flashHtml = flash ? (flash.type === 'error' ? `<div class="alert chat-flash">${escapeHtml(flash.message)}</div>` : `<div class="notice chat-flash">${escapeHtml(flash.message)}</div>`) : '';
  const messagesHtml = conversation?.messages?.length
    ? conversation.messages.map(renderMessage).join('')
    : `<div class="chat-welcome">${icon('graduation')}<p>دردشة مستقلة: ارفع بحثك فيقراه المناقش ثم يناقشك جزءا جزءا ثم يقييمك.</p></div>`;
  let composer = '';
  if (!conversation?.id) {
    composer = `<div class="chat-welcome"><form method="post" action="/defense/start"><button class="btn btn-primary" type="submit">ابدا دردشة مناقشة</button></form></div>`;
  } else if (current.done) {
    composer = `<div class="notice chat-flash">انتهت المناقشة — اقرا التقييم النهائي اعلاه.</div><div class="chat-welcome"><form method="post" action="/defense/start"><button class="btn btn-primary" type="submit">ابدأ مناقشة جديدة</button></form></div>`;
  } else if (!current.thesisFileId) {
    composer = `<div class="notice chat-flash">ارفع ملف البحث اعلاه ليبدا المناقش.</div>`;
  } else {
    composer = `<form class="chat-composer" method="post" action="/defense/${escapeHtml(conversation.id)}/answer"><div class="chat-composer-row"><textarea id="message" name="answer" rows="1" required maxlength="3000" placeholder="اكتب اجابتك…" aria-label="اجابتك"></textarea><button class="btn btn-primary chat-send" type="submit" title="ارسال" aria-label="ارسال">${icon('send')}</button></div></form>`;
  }
  // chat-card--defense: بطاقة المناقشة تتمدد بدل الارتفاع الثابت — نموذج تثبيت
  // الملف أسفل الرسائل، والارتفاع المقصوص كان يدفع زر البدء تحت الطيّ على الهاتف.
  const body = `<section class="card chat-card chat-card--defense">${flashHtml}${renderThesisBar(conversation, current)}${renderDefensePlan(current)}<div class="chat-body" id="messages">${messagesHtml}</div>${conversation?.id ? renderThesisCard(conversation, current, files) : ''}${composer}</section>`;
  return renderLayout({
    title: 'مناقشة البحث',
    pageHead: false,
    area: 'app',
    activeKey: 'defense',
    account,
    unread,
    fitViewport: true,
    scripts: ['/js/chat-auto-scroll.js', '/js/app-shell.js'],
    navBottom: renderConversations(sessions, conversation?.id || ''),
    body
  });
}
