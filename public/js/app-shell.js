/**
 * سلوك لوحة الباحث:
 * 1) قائمة جرس الإشعارات: تعليم كمقروء (فردي/الكل) وحذف — بدون إعادة تحميل الصفحة.
 * 2) فتح/غلق القوائم المنسدلة (الجرس + صورة الحساب) بالنقر أو زر Escape أو النقر خارجها.
 *
 * ملاحظات: لا سكربتات سطرية (CSP: 'self')، وكل النصوص تُكتب بـ textContent
 * لمنع أي حقن HTML قادم من قاعدة البيانات.
 */
(function () {
  'use strict';

  /** فتح/غلق قائمة منسدلة عامة: زر + قائمة، تُغلق مع القوائم الأخرى وزر Escape والنقر خارجها. */
  var dropdowns = [];

  function closeAllDropdowns(except) {
    dropdowns.forEach(function (entry) {
      if (entry === except) return;
      entry.menu.hidden = true;
      entry.toggle.setAttribute('aria-expanded', 'false');
    });
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
      // روابط القائمة تنتقل للصفحة المطلوبة؛ النقر داخلها فقط لا يُغلق قبل الانتقال
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

  // قائمة صورة الحساب: تعمل دائماً (حتى بلا جرس) في الشريط العلوي والترويسة العامة
  wireDropdown('user-toggle', 'user-menu');

  var toggle = document.getElementById('bell-toggle');
  var menu = document.getElementById('bell-menu');
  var list = document.getElementById('bell-list');
  var badge = document.getElementById('bell-badge');
  var empty = document.getElementById('bell-empty');
  var readAllButton = document.getElementById('bell-read-all');

  if (!toggle || !menu || !list) return;

  var items = [];
  // listLoaded: هل جُلبت القائمة ورُسمت فعلاً؟ (الجلب المسبق للشارة لا يكفي وحده)
  var listLoaded = false;

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

  var bellDropdown = wireDropdown('bell-toggle', 'bell-menu', {
    onOpen: function () {
      // إن كان الجلب المسبق قد انتهى نرسم ما وصلنا فوراً، ثم نتحقق من أي جديد
      if (listLoaded) render();
      load(false);
    }
  });
  if (!bellDropdown) return;

  if (readAllButton) readAllButton.addEventListener('click', markAllRead);

  // تحديث الشارة عند فتح الصفحة (بدون فتح القائمة) حتى تبقى الأرقام حديثة،
  // ونضع علامة أن القائمة جُلبت فعلاً حتى تُرسم لحظة فتح الجرس.
  request('/api/notifications')
    .then(function (data) {
      items = Array.isArray(data.items) ? data.items : [];
      listLoaded = true;
      setBadge(data.unread || 0);
    })
    .catch(function () {
      /* تبقى الشارة كما رسمها الخادم — لا نُظهر خطأ تقنياً في الشريط العلوي */
    });

})();
