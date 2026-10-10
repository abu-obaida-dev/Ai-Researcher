/**
 * إرسال رسالة الشات بلا إعادة تحميل الصفحة — تحسين تدريجي (progressive enhancement).
 *
 * - بلا جافاسكربت: النموذج يُرسل كـ POST عادي والخادم يعيد 303 — كما كان تماماً.
 * - مع الجافاسكربت: fetch مع Accept: application/json، والخادم يعيد قطع HTML
 *   مُعرَّضة بنفس دوال عرض الصفحة (مصدر واحد للشكل)، ونستبدلها في أماكنها:
 *   الرسائل + شريط الوضع + لوحة المراجع + قائمة المحادثات. لا تحديث للصفحة
 *   كاملة ولا قفزة تمرير، ويبقى وضع المناقشة وعدد أسئلته كما هما.
 * - عند أي فشل (شبكة/خادم/استجابة غير متوقعة): تنبيه + إعادة نص الباحث —
 *   ولا نُعيد الإرسال تلقائياً كي لا تُخصم نقاط مرتين.
 */
(function initChatSend() {
  'use strict';

  var form = document.querySelector('form.chat-composer');
  if (!form || form.getAttribute('data-chat-send-bound') === '1') return;
  form.setAttribute('data-chat-send-bound', '1');

  var input = form.querySelector('#message');
  var messagesBox = document.getElementById('messages');
  var card = document.querySelector('.chat-card');
  var busy = false;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy || !input) return;

    var text = input.value;
    if (!text.trim()) {
      showLiveFlash('اكتب رسالتك أولاً.');
      return;
    }

    busy = true;
    var button = form.querySelector('.chat-send');
    var restoreLabel = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }

    // فقاعة معلّقة لرسالة الباحث + مؤشر «يكتب…» — تُبدَلان بردّ الخادم الحقيقي
    var typing = document.createElement('div');
    typing.className = 'bubble bubble-ai is-thinking';
    typing.textContent = document.querySelector('.chat-modebar.is-defense')
      ? 'المشرف يكتب…'
      : 'المشرف الذكي يكتب…';
    if (messagesBox) {
      messagesBox.appendChild(pendingBubble(text));
      messagesBox.appendChild(typing);
      scrollToBottom();
    }
    input.value = '';

    // جسم الطلب كما يفهمه المسار التقليدي (express.json يعالجه عالمياً)
    var payload = {
      message: text,
      conversation_id: field('conversation_id'),
      step: field('step')
    };
    var files = form.querySelectorAll('input[name="file_ids"]:checked');
    if (files.length) {
      payload.file_ids = [];
      for (var i = 0; i < files.length; i++) payload.file_ids.push(files[i].value);
    }

    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.text().then(function (raw) {
          var data = null;
          try {
            data = JSON.parse(raw);
          } catch (e) {
            data = null;
          }
          return { response: response, data: data, raw: raw };
        });
      })
      .then(function (result) {
        var response = result.response;
        var data = result.data;

        if (response.ok && data && data.ok && data.fragments) {
          applyFragments(data);
          clearLiveFlash();
          return;
        }

        failSend(
          (data && data.error && data.error.message) ||
            shortText(result.raw, response.status) ||
            'تعذّر إرسال الرسالة — أعد المحاولة.',
          text
        );
      })
      .catch(function () {
        failSend('تعذّر الاتصال بالخادم — تحقّق من الشبكة وأعد المحاولة.', text);
      })
      .then(function () {
        busy = false;
        if (button) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.textContent = restoreLabel;
        }
        wireRefs();
        input.focus();
      });
  });

  /** فقاعة رسالة المستخدم بنفس أبعاد فقاعات الخادم، والنص يُكتب نصاً لا HTML. */
  function pendingBubble(text) {
    var el = document.createElement('div');
    el.className = 'bubble bubble-user is-pending';
    var body = document.createElement('p');
    body.className = 'bubble-text';
    body.textContent = text;
    var meta = document.createElement('p');
    meta.className = 'bubble-meta';
    meta.textContent = 'أنت · الآن';
    el.appendChild(body);
    el.appendChild(meta);
    return el;
  }

  /** قيمة حقل مخفي داخل النموذج (أو سلسلة فارغة). */
  function field(name) {
    var el = form.querySelector('input[name="' + name + '"]');
    return el ? el.value : '';
  }

  /** تمرير صندوق الرسائل إلى أسفله (بعد إضافة فقاعة). */
  function scrollToBottom() {
    if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
  }
  /**
   * استبدال قطع الصفحة بالقطع الجديدة القادمة من الخادم — نفس مواضع التخطيط:
   * شريط الوضع قبل #messages، لوحة المراجع بين الرسائل والنموذج،
   * وقائمة المحادثات في السايدبار.
   */
  function applyFragments(data) {
    var fragments = data.fragments || {};

    // الرسائل الكاملة (بما فيها بطاقة مراجعة الخطوة إن ظهرت)
    if (messagesBox && fragments.messagesHtml != null) {
      messagesBox.innerHTML = fragments.messagesHtml;
    }

    // شريط الوضع (يحمل عدّاد أسئلة المناقشة إن كان في وضع المناقشة)
    var bar = document.querySelector('.chat-modebar');
    if (fragments.modeBarHtml) {
      if (bar) bar.outerHTML = fragments.modeBarHtml;
      else if (messagesBox) messagesBox.insertAdjacentHTML('beforebegin', fragments.modeBarHtml);
    }

    // لوحة المراجع: تُحذف القديمة وتُدرج الجديدة قبل النموذج إن وُجدت
    var oldRefs = document.getElementById('chat-refs');
    if (oldRefs) oldRefs.remove();
    if (fragments.refsHtml) form.insertAdjacentHTML('beforebegin', fragments.refsHtml);

    // معرّف المحادثة: يتحدّث بعد أول رسالة (محادثة جديدة)
    if (data.conversationId) {
      var idField = form.querySelector('input[name="conversation_id"]');
      if (idField) idField.value = data.conversationId;
    }

    // قوائم المحادثات في السايدبار (العنوان/العدّاد/الترتيب)
    var nav = document.querySelector('.chat-nav');
    if (nav && fragments.conversationsHtml) nav.outerHTML = fragments.conversationsHtml;

    // إلغاء تحديد الملفات المرفقة (كما تفعل إعادة التحميل التقليدية)
    var checked = form.querySelectorAll('input[name="file_ids"]:checked');
    for (var i = 0; i < checked.length; i++) checked[i].checked = false;

    // الرابط في شريط العنوان: يبقى قابلاً للنسخة/التحديث بلا إعادة تحميل
    if (data.conversationUrl && window.history && history.replaceState) {
      history.replaceState(null, '', data.conversationUrl);
    }

    scrollToBottom();
  }

  /**
   * تراجع عند الفشل: إزالة الفقاعتين المؤقتتين، إعادة نص الباحث، وتنبيه.
   */
  function failSend(message, text) {
    if (messagesBox) {
      var pendingEls = messagesBox.querySelectorAll('.is-pending, .is-thinking');
      for (var i = 0; i < pendingEls.length; i++) pendingEls[i].remove();
    }
    if (input && !input.value) input.value = text;
    showLiveFlash(message);
  }

  /** تنبيه مؤقت أعلى الكارت (بلا حقن HTML: النص يُكتب نصاً). */
  function showLiveFlash(message) {
    if (!card) return;
    var el = document.createElement('div');
    el.className = 'alert chat-flash chat-flash-live';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    var existing = card.querySelector('.chat-flash-live');
    if (existing) existing.remove();
    card.insertBefore(el, card.firstChild);
  }

  function clearLiveFlash() {
    var el = card && card.querySelector('.chat-flash-live');
    if (el) el.remove();
  }

  /**
   * قراءة رسالة خطأ من استجابة ليست JSON (مثل حدّ المعدّل نصّاً) — نص قصير فقط،
   * وما فيه HTML نتجاهله (لا نعرض مارك أب من الخادم داخل تنبيه).
   */
  function shortText(raw, status) {
    var text = String(raw || '').trim();
    if (!text || /<[^>]+>/.test(text)) return status ? '(رمز ' + status + ')' : '';
    return text.slice(0, 200);
  }

  /**
   * إعادة ربط فتح/غلق لوحة المراجع بالتمرير — لأن العنصر قد يُستبدل حديثاً.
   * (السلوك نفسه الذي يربطه chat-auto-scroll.js عند تحميل الصفحة.)
   */
  function wireRefs() {
    var refs = document.getElementById('chat-refs');
    if (!refs || refs.getAttribute('data-refs-wired') === '1') return;
    refs.setAttribute('data-refs-wired', '1');
    refs.addEventListener('toggle', function () {
      refs.scrollTop = refs.open ? 0 : refs.scrollHeight;
    });
  }
})();
