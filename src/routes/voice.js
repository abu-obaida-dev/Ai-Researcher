import express from 'express';
import { requireAccount } from '../middleware/auth.js';
import { getProfile } from '../services/users.js';
import {
  currentVoiceWhatsappMale,
  currentVoiceWhatsappFemale
} from '../services/settings.js';
import { unreadCount } from '../services/notifications.js';
import { escapeHtml, renderLayout, renderNotice } from '../views/layout.js';

/** أيقونة SVG من ملف الرموز (sprite) — محلية في هذا الملف لأن المستخدم يأتي من `<svg><use href="#icon-...">`. */
function icon(name, sizeClass = '') {
  return `<svg class="icon ${sizeClass}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

const router = express.Router();

/**
 * صفحة المناقشة الصوتية عبر واتساب (/voice).
 * تعرض زرين واتساب منفصلين: أحدهما للشباب والآخر للبنات.
 * يضغط الباحث على الزر الذي يناسبه ليفتح محادثة واتساب مباشرةً
 * (نفس سلوك زر الدعم الفني العائم).
 */
router.get('/voice', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const [profile, unread] = await Promise.all([getProfile(userId), unreadCount(userId)]);
    const gender = profile?.gender || '';

    const maleNumber = currentVoiceWhatsappMale();
    const femaleNumber = currentVoiceWhatsappFemale();
    const hasMale = Boolean(maleNumber);
    const hasFemale = Boolean(femaleNumber);

    const maleLink = hasMale ? `https://wa.me/${maleNumber.replace(/\D/g, '')}` : null;
    const femaleLink = hasFemale ? `https://wa.me/${femaleNumber.replace(/\D/g, '')}` : null;

    const body = `<section class="card chat-card">
      <div class="chat-body" id="messages">
        <div class="bubble bubble-ai">
          <p class="bubble-text">أهلاً بك في خدمة المناقشة الصوتية عبر واتساب.</p>
          <p class="bubble-meta">المعلم · الآن</p>
        </div>
      </div>

      <div class="voice-card mt-16">
        <div class="card-head">
          <h2>المناقشة الصوتية عبر واتساب</h2>
        </div>
        <p class="muted">
          اختر الزر المناسب لنوعك لفتح محادثة واتساب مباشرةً مع المعلم.
          نوعك المسجَّل حالياً: <span class="strong">${escapeHtml(gender || 'غير محدد')}</span>.
          يمكن تعديل النوع من <a href="/onboarding">ملفك البحثي</a>.
        </p>

        <div class="form-grid">
          ${hasMale
            ? `<a class="btn btn-primary btn-block" href="${escapeHtml(maleLink)}" target="_blank" rel="noopener">
               ${icon('phone', 'icon-sm')} واتساب للشباب — ${escapeHtml(maleNumber)}
             </a>`
            : `<button class="btn btn-block" disabled style="opacity:.6;border-style:dashed;">
               ${icon('phone', 'icon-sm')} واتساب للشباب — غير مضبوط بعد
             </button>`
          }

          ${hasFemale
            ? `<a class="btn btn-primary btn-block" href="${escapeHtml(femaleLink)}" target="_blank" rel="noopener">
               ${icon('phone', 'icon-sm')} واتساب للبنات — ${escapeHtml(femaleNumber)}
             </a>`
            : `<button class="btn btn-block" disabled style="opacity:.6;border-style:dashed;">
               ${icon('phone', 'icon-sm')} واتساب للبنات — غير مضبوط بعد
             </button>`
          }
        </div>

        <p class="muted chat-voice-hint">
          المناقشة تكون عبر تطبيق واتساب على هاتفك — ليست محادثة داخل الموقع.
          يمكنك إرفاق ملفاتك أو مراجعك أثناء التحدث مع المعلم للاستفسار عنها.
        </p>
      </div>
    </section>`;

    res.type('html').send(
      renderLayout({
        title: 'المناقشة الصوتية',
        subtitle: 'اتصل بالمعلم عبر واتساب',
        pageHead: false,
        area: 'app',
        activeKey: 'voice',
        account: req.account,
        unread,
        fitViewport: true,
        scripts: ['/js/app-shell.js'],
        navBottom: '',
        body
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل صفحة الصوت',
      message: 'حدث خطأ أثناء جلب أرقام الواتساب — أعد المحاولة.',
      details: error?.message || '',
      area: 'app',
      activeKey: 'voice'
    });
    res.status(500).type('html').send(html);
  }
});

export { router as voiceRouter };
