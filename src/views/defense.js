import { formatDateTime } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';
import { renderThesisBar, renderThesisCard, renderConversations, renderDefenseGradeNotice, renderDefensePlan, renderDefenseStats } from './defense-parts.js';

/** Full-screen defense chat with the session list in the sidebar. */
function renderMessage(message) {
  const isUser = message.role === 'user';
  // Render system notices separately from the conversation.
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
  let combinedShown = false;
  const messagesHtml = conversation?.messages?.length
  ? (() => {
      let welcomeShownLocal = false;

      const filtered = conversation.messages.filter((m) => {
        // Hide obsolete upload prompts after the thesis is attached.
        if (
          current.thesisFileId &&
          m.role === 'assistant' &&
          (
            m.content.includes('يرجى رفع ملف بحثك') ||
            m.content.includes('ارفع ملف بحثك') ||
            m.content.includes('ثبت ملف بحثك') ||
            m.content.includes('اختيار ملف البحث')
          )
        ) {
          return false;
        }

        // Keep only the first welcome message.
        const isWelcome = /^مرح/.test(m.content);

        if (isWelcome && welcomeShownLocal) return false;
        if (isWelcome) welcomeShownLocal = true;

        return true;
      });

      return filtered.map(renderMessage).join('');
    })()
  : `<div class="chat-welcome">${icon('graduation')}<p>دردشة مستقلة: ارفع بحثك فيقرأه المناقش ويبدأ المناقشة.</p></div>`;
  let composer = '';
  if (!conversation?.id) {
    composer = `<div class="chat-welcome"><form method="post" action="/defense/start"><button class="btn btn-primary" type="submit">ابدا دردشة مناقشة</button></form></div>`;
  } else if (current.done) {
    composer = `<div class="chat-welcome"><form method="post" action="/defense/start"><button class="btn btn-primary" type="submit">ابدأ مناقشة جديدة</button></form></div>`;
  } else if (!current.thesisFileId && !conversation?.messages?.length) {
    composer = `<div class="notice chat-flash">ارفع ملف البحث اعلاه ليبدا المناقش.</div>`;
  } else {
    composer = `<form class="chat-composer" method="post" action="/defense/${escapeHtml(conversation.id)}/answer"><div class="chat-composer-row"><textarea id="message" name="answer" rows="1" required maxlength="3000" placeholder="اكتب اجابتك…" aria-label="اجابتك"></textarea><button class="btn btn-primary chat-send" type="submit" title="ارسال" aria-label="ارسال">${icon('send')}</button></div></form>`;
  }
  const body = `<div class="defense-page"><section class="card chat-card chat-card--defense">${flashHtml}${renderThesisBar(conversation, current)}${renderDefenseGradeNotice(current)}${renderDefensePlan(current)}<div class="chat-body" id="messages">${messagesHtml}</div>${conversation?.id ? renderThesisCard(conversation, current, files) : ''}${composer}</section>${renderDefenseStats(current)}</div>`;
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
