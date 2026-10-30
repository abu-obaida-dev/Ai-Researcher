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

  /**
   * إبقاء القائمة المنسدلة داخل حدود الشاشة — مرونتها على مقاسات الهاتف المختلفة:
   * القائمة مرسومة من حافة زرّها للداخل عبر position:absolute وعرضها
   * min(370px, 100vw - 20px)، ولا تعرف CSS كم يبعد الزر عن حافة الشاشة
   * (يليه صورة الحساب والهامبرغر)؛ فعلى الهواتف تتجاوز الحافة اليمنى ويقصّها
   * overflow-x على html/body فيختفي جزء منها (عناوين الإشعارات تحديداً).
   * نقيس بعد كل فتح/رسم ونصحّح: انزاحة أفقية للبقاء بين هوامش الشاشة، وتقليص
   * الارتفاع إن تجاوزت الأسفل — رأس القائمة ثابت وقائمتها تُمرَّر فلا يضيع محتوى.
   */
  var FIT_MARGIN = 8; // هوامش أمان (بكسل) بين القائمة وحافة الشاشة

  function fitDropdown(entry) {
    var el = entry && entry.menu;
    if (!el || el.hidden) return;

    // نبدأ من إعدادات CSS خالصة: الشاشة قد تغيّرت منذ آخر ضبط (تدوير/شريط عنوان)
    el.style.width = '';
    el.style.maxHeight = '';
    el.style.transform = '';

    var doc = document.documentElement;
    var vw = doc.clientWidth; // العرض المرئي الحقيقي — 100vw تشمل شريط التمرير
    var vh = doc.clientHeight;
    if (vw < 2 || vh < 2) return;

    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // عرض أوسع من الشاشة (شريط تمرير أو حواف ملء الشاشة): نقيّده داخل الهوامش
    if (rect.width > vw - 2 * FIT_MARGIN) {
      el.style.width = Math.floor(vw - 2 * FIT_MARGIN) + 'px';
      rect = el.getBoundingClientRect();
    }

    var left = rect.left;
    if (left + rect.width > vw - FIT_MARGIN) left = (vw - FIT_MARGIN) - rect.width;
    if (left < FIT_MARGIN) left = FIT_MARGIN;
    var dx = left - rect.left;
    if (dx) el.style.transform = 'translateX(' + Math.round(dx) + 'px)';

    // عمودياً: إن تجاوزت حافة الأسفل ننقص من ارتفاعها بدل النزول — يبقى الرأس
    // ظاهراً وقائمة الإشعارات تُمرَّر تحته (كما تفعل أصلاً عند تجاوز السقف CSS).
    rect = el.getBoundingClientRect();
    var overflowBottom = rect.bottom - (vh - FIT_MARGIN);
    if (overflowBottom > 0) {
      el.style.maxHeight = Math.max(160, Math.round(rect.height - overflowBottom)) + 'px';
    }
  }

  /** إعادة ضبط كل القوائم المفتوحة — تُستدعى مع أي تغيّر في أبعاد الشاشة أو المحتوى. */
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
        // بعد الرسم الأول — القياس يجبر التخطيط فوراً فلا تُرى القائمة متجاوزة قبل التصحيح
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

  // شاشات الهاتف تغيّر أبعادها باستمرار (شريط العنوان يظهر/يختفي، والتدوير،
  // وفتح صفحات بعرض مختلف) — نعيد ضبط القوائم المفتوحة فتبقى كاملة داخل الرؤية.
  window.addEventListener('resize', fitOpenDropdowns);
  window.addEventListener('orientationchange', fitOpenDropdowns);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitOpenDropdowns);

  // قائمة صورة الحساب: تعمل دائماً (حتى بلا جرس) في الشريط العلوي والترويسة العامة
  wireDropdown('user-toggle', 'user-menu');

  // تأكيد قبل إرسال أي نموذج يحمل data-confirm (حذف وإجراءات خطيرة).
  // يُثبَّت هنا قبل فحص الجرس ليعمل على كل الصفحات حتى بلا جلسة.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var question = form && form.getAttribute ? form.getAttribute('data-confirm') : null;
    if (question && !window.confirm(question)) event.preventDefault();
  });

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
    fitOpenDropdowns(); // المحتوى ازداد أو نقص — أعِد ضبط الموضع والارتفاع
  }

  /** طلب JSON بنفس نطاق الموقع مع ترجمة الأخطاء إلى رسالة عربية. */
  function request(url, options) {
    var config = options || {};
    config.credentials = 'same-origin';
    config.headers = { 'Content-Type': 'application/json' };
    if (!config.method) config.method = 'GET';

    return fetch(url, config).then(function (response) {
      if (response.status === 401) {
        // جلسة منتهية أو غير موجودة — أعد توجيه المستخدم للدخول
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
