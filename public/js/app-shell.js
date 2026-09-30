/**
 * سلوك لوحة الباحث:
 * 1) قائمة جرس الإشعارات: تعليم كمقروء (فردي/الكل) وحذف — بدون إعادة تحميل الصفحة.
 * 2) فتح/غلق القائمة بالنقر أو زر Escape أو النقر خارجها.
 *
 * ملاحظات: لا سكربتات سطرية (CSP: 'self')، وكل النصوص تُكتب بـ textContent
 * لمنع أي حقن HTML قادم من قاعدة البيانات.
 */
(function () {
  'use strict';

  var toggle = document.getElementById('bell-toggle');
  var menu = document.getElementById('bell-menu');
  var list = document.getElementById('bell-list');
  var badge = document.getElementById('bell-badge');
  var empty = document.getElementById('bell-empty');
  var readAllButton = document.getElementById('bell-read-all');

  if (!toggle || !menu || !list) return;

  var items = [];
  var loaded = false;

  /** شارة عدد غير المقروء في الشريط العلوي. */
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

  /** صياغة تاريخ الإشعار بالعربية. */
  function timeText(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function showEmpty(message) {
    if (!empty) return;
    empty.hidden = false;
    empty.textContent = message;
  }

  function countUnread() {
    return items.filter(function (row) {
      return !row.read;
    }).length;
  }

  /** رسم قائمة الإشعارات من المصفوفة الحالية (نص فقط — بلا HTML). */
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
  }

  /** طلب JSON بنفس نطاق الموقع مع ترجمة الأخطاء إلى رسالة عربية. */
  function request(url, options) {
    var config = options || {};
    config.credentials = 'same-origin';
    config.headers = { 'Content-Type': 'application/json' };
    if (!config.method) config.method = 'GET';

    return fetch(url, config).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || data.ok === false) {
          throw new Error(data.message || 'تعذّر تنفيذ الطلب.');
        }
        return data;
      });
    });
  }

  /** تحميل الإشعارات (مرة واحدة عند أول فتح، أو إجبارياً). */
  function load(force) {
    if (loaded && !force) return Promise.resolve();
    showEmpty('جارٍ تحميل الإشعارات…');

    return request('/api/notifications')
      .then(function (data) {
        items = Array.isArray(data.items) ? data.items : [];
        loaded = true;
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

  function openMenu() {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    load(false);
  }

  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function (event) {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener('click', function (event) {
    event.stopPropagation();
  });

  document.addEventListener('click', function () {
    if (!menu.hidden) closeMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !menu.hidden) closeMenu();
  });

  if (readAllButton) readAllButton.addEventListener('click', markAllRead);

  // تحديث الشارة عند فتح الصفحة (بدون فتح القائمة) حتى تبقى الأرقام حديثة
  request('/api/notifications')
    .then(function (data) {
      items = Array.isArray(data.items) ? data.items : [];
      loaded = true;
      setBadge(data.unread || 0);
    })
    .catch(function () {
      /* تبقى الشارة كما رسمها الخادم — لا نُظهر خطأ تقنياً في الشريط العلوي */
    });

})();
