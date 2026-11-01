/** Enhances chat submission with fragment updates while preserving normal form fallback. */
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
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }

    // Show optimistic user and typing messages until the server response arrives.
    var typing = document.createElement('div');
    typing.className = 'bubble bubble-ai is-thinking';
    typing.textContent = 'المشرف الذكي يكتب…';
    if (messagesBox) {
      messagesBox.appendChild(pendingBubble(text));
      messagesBox.appendChild(typing);
      scrollToBottom();
    }
    input.value = '';

    // Require a selected conversation before the server reads or charges the request.
    var payload = {
      message: text,
      conversation_id: (function () {
        var raw = field('conversation_id');
        return (raw && raw.trim()) ? raw.trim() : null;
      })(),
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
        }
        wireRefs();
        input.focus();
      });
  });

  /** Builds a safe optimistic user message. */
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

  /** Reads a hidden form field. */
  function field(name) {
    var el = form.querySelector('input[name="' + name + '"]');
    return el ? el.value : '';
  }

  /** Scrolls the message list to the bottom. */
  function scrollToBottom() {
    if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
  }
  /** Replaces server-rendered fragments in their existing layout positions. */
  function applyFragments(data) {
    var fragments = data.fragments || {};

    // Replace messages, including any pending step-review card.
    if (messagesBox && fragments.messagesHtml != null) {
      messagesBox.innerHTML = fragments.messagesHtml;
    }

    // Replace the references panel before the form.
    var oldRefs = document.getElementById('chat-refs');
    if (oldRefs) oldRefs.remove();
    if (fragments.refsHtml) form.insertAdjacentHTML('beforebegin', fragments.refsHtml);


    // Save the new conversation ID after the first message.
    if (data.conversationId) {
      var idField = form.querySelector('input[name="conversation_id"]');
      if (idField) idField.value = data.conversationId;
    }

    // Refresh the conversation sidebar.
    var nav = document.querySelector('.chat-nav');
    if (nav && fragments.conversationsHtml) nav.outerHTML = fragments.conversationsHtml;

    // Match the normal form behavior by clearing selected attachments.
    var checked = form.querySelectorAll('input[name="file_ids"]:checked');
    for (var i = 0; i < checked.length; i++) checked[i].checked = false;

    // Keep the URL usable for refreshes and sharing without reloading.
    if (data.conversationUrl && window.history && history.replaceState) {
      history.replaceState(null, '', data.conversationUrl);
    }

    scrollToBottom();
  }

  /** Rolls back optimistic messages and restores the user's text on failure. */
  function failSend(message, text) {
    if (messagesBox) {
      var pendingEls = messagesBox.querySelectorAll('.is-pending, .is-thinking');
      for (var i = 0; i < pendingEls.length; i++) pendingEls[i].remove();
    }
    if (input && !input.value) input.value = text;
    showLiveFlash(message);
  }

  /** Shows a temporary, text-only error message. */
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

  /** Extracts a short plain-text error from non-JSON responses. */
  function shortText(raw, status) {
    var text = String(raw || '').trim();
    if (!text || /<[^>]+>/.test(text)) return status ? '(رمز ' + status + ')' : '';
    return text.slice(0, 200);
  }

  /** Rebinds the toggle handler when the references panel is replaced. */
  function wireRefs() {
    var refs = document.getElementById('chat-refs');
    if (!refs || refs.getAttribute('data-refs-wired') === '1') return;
    refs.setAttribute('data-refs-wired', '1');
    refs.addEventListener('toggle', function () {
      refs.scrollTop = refs.open ? 0 : refs.scrollHeight;
    });
  }
})();
