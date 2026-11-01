/** Shared dashboard behavior. Dynamic text uses textContent to avoid HTML injection. */
(function () {
  'use strict';

  /** Wires a dropdown and its close interactions. */
  var dropdowns = [];

  function closeAllDropdowns(except) {
    dropdowns.forEach(function (entry) {
      if (entry === except) return;
      entry.menu.hidden = true;
      entry.toggle.setAttribute('aria-expanded', 'false');
    });
  }

  /** Keeps open menus within the viewport, including on narrow screens. */
  var FIT_MARGIN = 8; // هوامش أمان (بكسل) بين القائمة وحافة الشاشة

  function fitDropdown(entry) {
    var el = entry && entry.menu;
    if (!el || el.hidden) return;

    // Re-measure from CSS because viewport dimensions may have changed.
    el.style.width = '';
    el.style.maxHeight = '';
    el.style.transform = '';

    var doc = document.documentElement;
    var vw = doc.clientWidth; // العرض المرئي الحقيقي — 100vw تشمل شريط التمرير
    var vh = doc.clientHeight;
    if (vw < 2 || vh < 2) return;

    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Constrain menus wider than the viewport.
    if (rect.width > vw - 2 * FIT_MARGIN) {
      el.style.width = Math.floor(vw - 2 * FIT_MARGIN) + 'px';
      rect = el.getBoundingClientRect();
    }

    var left = rect.left;
    if (left + rect.width > vw - FIT_MARGIN) left = (vw - FIT_MARGIN) - rect.width;
    if (left < FIT_MARGIN) left = FIT_MARGIN;
    var dx = left - rect.left;
    if (dx) el.style.transform = 'translateX(' + Math.round(dx) + 'px)';

    // Keep the menu header visible and scroll its contents when it exceeds the viewport.
    rect = el.getBoundingClientRect();
    var overflowBottom = rect.bottom - (vh - FIT_MARGIN);
    if (overflowBottom > 0) {
      el.style.maxHeight = Math.max(160, Math.round(rect.height - overflowBottom)) + 'px';
    }
  }

  /** Repositions open menus after viewport changes. */
  function fitOpenDropdowns() {
    dropdowns.forEach(fitDropdown);
  }

  function wireDropdown(toggleId, menuId, options) {
    var toggle = document.getElementById(toggleId);
    var menu = document.getElementById(menuId);
    if (!toggle || !menu) return null;
    var onOpen = options && typeof options.onOpen === 'function' ? options.onOpen : null;

    var entry = {
      toggle: toggle,
      menu: menu,
      open: function () {
        closeAllDropdowns(entry);
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        if (onOpen) onOpen();
        // Measure immediately after rendering to avoid a visible overflow frame.
        fitDropdown(entry);
      },
      close: function () {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    };

    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menu.hidden) entry.open();
      else entry.close();
    });

    menu.addEventListener('click', function (event) {
      // Allow navigation links to proceed without closing the menu first.
      if (event.target.closest('a')) return;
      event.stopPropagation();
    });

    dropdowns.push(entry);
    return entry;
  }

  document.addEventListener('click', function () {
    closeAllDropdowns(null);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeAllDropdowns(null);
  });

  // Mobile browser chrome and orientation changes can resize the viewport.
  window.addEventListener('resize', fitOpenDropdowns);
  window.addEventListener('orientationchange', fitOpenDropdowns);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitOpenDropdowns);

  // The account menu is available even when notifications are disabled.
  wireDropdown('user-toggle', 'user-menu');

  // Handle confirmation and defense-upload loading on every page.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var question = form && form.getAttribute ? form.getAttribute('data-confirm') : null;
    if (question && !window.confirm(question)) event.preventDefault();
    if (!form || !form.matches || !form.matches('.defense-thesis-form')) return;
    if (form.getAttribute('data-submitting') === '1') {
      event.preventDefault();
      return;
    }

    form.setAttribute('data-submitting', '1');
    form.setAttribute('aria-busy', 'true');
    var button = form.querySelector('.defense-thesis-submit');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'جارٍ تجهيز المناقشة…';
    }
    var status = form.querySelector('[data-upload-status]');
    if (status) status.hidden = false;
  });

  var toggle = document.getElementById('bell-toggle');
  var menu = document.getElementById('bell-menu');
  var list = document.getElementById('bell-list');
  var badge = document.getElementById('bell-badge');
  var empty = document.getElementById('bell-empty');
  var readAllButton = document.getElementById('bell-read-all');

  if (!toggle || !menu || !list) return;

  var items = [];
  // The badge prefetch does not count as loading the visible list.
  var listLoaded = false;

  /** Updates the unread count badge. */
  function setBadge(count) {
    if (!badge) return;
    var value = Number(count) || 0;
    if (value > 0) {
      badge.hidden = false;
      badge.textContent = value > 99 ? '99+' : String(value);
    } else {
      badge.hidden = true;
      badge.textContent = '0';
    }
  }

  /** Formats a notification timestamp. */
  function timeText(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function showEmpty(message) {
    if (!empty) return;
    empty.hidden = false;
    empty.textContent = message;
    fitOpenDropdowns(); // ارتفاع القائمة تغيّر — أعد ضبطها داخل الشاشة
  }

  function countUnread() {
    return items.filter(function (row) {
      return !row.read;
    }).length;
  }

  /** Renders notifications using text nodes only. */
  function render() {
    list.innerHTML = '';
    if (empty) empty.hidden = items.length > 0;

    if (!items.length) {
      showEmpty('لا توجد إشعارات بعد — نُرسل لك الجديد هنا فور حدوثه.');
      return;
    }

    items.forEach(function (item) {
      var li = document.createElement('li');
      if (!item.read) li.className = 'unread';

      var body = document.createElement('div');
      body.className = 'bell-item-body';

      var title = document.createElement('p');
      title.className = 'bell-item-title';
      title.textContent = String(item.title || 'إشعار');
      body.appendChild(title);

      if (item.body) {
        var text = document.createElement('p');
        text.className = 'bell-item-text';
        text.textContent = String(item.body);
        body.appendChild(text);
      }

      var time = document.createElement('p');
      time.className = 'bell-item-time';
      time.textContent = timeText(item.created_at);
      body.appendChild(time);

      li.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'bell-item-actions';

      if (!item.read) {
        var readButton = document.createElement('button');
        readButton.type = 'button';
        readButton.className = 'bell-mini';
        readButton.textContent = 'تعليم كمقروء';
        readButton.addEventListener('click', function () {
          markRead(item, li);
        });
        actions.appendChild(readButton);
      }

      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'bell-mini';
      deleteButton.textContent = 'حذف';
      deleteButton.addEventListener('click', function () {
        remove(item, li);
      });
      actions.appendChild(deleteButton);

      li.appendChild(actions);
      list.appendChild(li);
    });
    fitOpenDropdowns(); // المحتوى ازداد أو نقص — أعِد ضبط الموضع والارتفاع
  }

  /** Sends a same-origin JSON request. */
  function request(url, options) {
    var config = options || {};
    config.credentials = 'same-origin';
    config.headers = { 'Content-Type': 'application/json' };
    if (!config.method) config.method = 'GET';

    return fetch(url, config).then(function (response) {
      if (response.status === 401) {
        // Redirect expired sessions to sign-in.
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
        throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً.');
      }
      return response.json().then(function (data) {
        if (!response.ok || data.ok === false) {
          throw new Error(data.message || 'تعذّر تنفيذ الطلب.');
        }
        return data;
      });
    });
  }

  /** Loads notifications once, unless a refresh is requested. */
  function load(force) {
    if (listLoaded && !force) return Promise.resolve();
    showEmpty('جارٍ تحميل الإشعارات…');

    return request('/api/notifications')
      .then(function (data) {
        items = Array.isArray(data.items) ? data.items : [];
        listLoaded = true;
        setBadge(data.unread || 0);
        render();
      })
      .catch(function (error) {
        showEmpty(error.message);
      });
  }

  function markRead(item, node) {
    request('/api/notifications/' + encodeURIComponent(item.id) + '/read', { method: 'POST' })
      .then(function (data) {
        item.read = true;
        if (node) {
          node.classList.remove('unread');
          var button = node.querySelector('.bell-mini');
          if (button && button.textContent === 'تعليم كمقروء') button.remove();
        }
        setBadge(typeof data.unread === 'number' ? data.unread : countUnread());
        fitOpenDropdowns(); // زر «تعليم كمقروء» أُزيل ⇒ القائمة أقصر وتستحق سقفاً أكبر
      })
      .catch(function (error) {
        showEmpty(error.message);
      });
  }

  function remove(item, node) {
    request('/api/notifications/' + encodeURIComponent(item.id), { method: 'DELETE' })
      .then(function (data) {
        items = items.filter(function (row) {
          return row.id !== item.id;
        });
        if (node) node.remove();
        setBadge(typeof data.unread === 'number' ? data.unread : countUnread());
        if (!items.length) showEmpty('لا توجد إشعارات بعد — نُرسل لك الجديد هنا فور حدوثه.');
        fitOpenDropdowns(); // صفّا حُذف ⇒ أعد ضبط ارتفاع القائمة
      })
      .catch(function (error) {
        showEmpty(error.message);
      });
  }

  function markAllRead() {
    request('/api/notifications/read-all', { method: 'POST' })
      .then(function () {
        items = items.map(function (row) {
          if (!row.read) row.read = true;
          return row;
        });
        setBadge(0);
        render();
      })
      .catch(function (error) {
        showEmpty(error.message);
      });
  }

  var bellDropdown = wireDropdown('bell-toggle', 'bell-menu', {
    onOpen: function () {
      // Render prefetched data immediately, then refresh it if needed.
      if (listLoaded) render();
      load(false);
    }
  });
  if (!bellDropdown) return;

  if (readAllButton) readAllButton.addEventListener('click', markAllRead);

  // Refresh the count without opening the menu and reuse the result when opened.
  request('/api/notifications')
    .then(function (data) {
      items = Array.isArray(data.items) ? data.items : [];
      listLoaded = true;
      setBadge(data.unread || 0);
    })
    .catch(function () {
      /* Keep the server-rendered badge if the background request fails. */
    });

})();
