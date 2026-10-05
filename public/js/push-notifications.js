/* eslint-disable no-undef */
/**
 * تفعيل إشعارات الهاتف (Firebase Cloud Messaging — Web Push).
 *
 * التدفّق من زر واحد داخل قائمة الجرس:
 *   1) نطلب إذن الإشعارات (لا يُطلب تلقائياً — بضغط المستخدم فقط).
 *   2) نقرأ الإعدادات العامة من نفس النطاق (/api/firebase-config) — لا أسرار هنا.
 *   3) نسجّل Service Worker ثم نطلب توكن FCM ونحفظه في /api/notifications/register.
 *   4) عند التعذّر (متصفح قديم · إعدادات ناقصة · إذن مرفوض) نشرح السبب بالعربية
 *      بدل الفشل الصامت.
 *
 * Chrome/Edge على HTTPS (أو localhost) هو المدعوم؛ ما عداه نُبلغ المستخدم بوضوح.
 */
(function () {
  'use strict';

  var SW_PATH = '/firebase-messaging-sw.js';
  var FIREBASE_VERSION = '10.12.2';

  var state = { enabled: false, config: null };

  function el(id) {
    return document.getElementById(id);
  }

  function note(text) {
    var node = el('push-note');
    if (node) node.textContent = text || '';
  }

  function setButton(text) {
    var button = el('push-toggle');
    if (button) button.textContent = text;
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      });
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onload = function () {
        resolve();
      };
      tag.onerror = reject;
      document.head.appendChild(tag);
    });
  }
  /** إعدادات Firebase العامة؛ ترجع خطأ صريحاً إن كان المشروع غير مكتمل. */
  function loadConfig() {
    return fetch('/api/firebase-config', { headers: { accept: 'application/json' } })
      .then(function (res) {
        return res.json();
      })
      .then(function (config) {
        if (!config || !config.configured) {
          var missing = [];
          if (!config || !config.apiKey) missing.push('Web API key');
          if (!config || !config.appId) missing.push('App ID');
          if (!config || !config.projectId) missing.push('Project ID');
          throw new Error('إعدادات المشروع ناقصة: ' + missing.join(' · '));
        }
        return config;
      });
  }

  function ensureWorker() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('متصفحك لا يدعم الإشعارات.'));
    return navigator.serviceWorker.register(SW_PATH).catch(function () {
      throw new Error('تعذّر تفعيل عامل الخدمة (Service Worker).');
    });
  }

  function loadFirebase(config) {
    if (window.firebase && window.firebase.messaging) return Promise.resolve(window.firebase);
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    return loadScript(base + 'firebase-app-compat.js')
      .then(function () {
        return loadScript(base + 'firebase-messaging-compat.js');
      })
      .then(function () {
        if (!window.firebase) throw new Error('تعذّر تحميل مكتبة Firebase.');
        if (!window.firebase.apps.length) window.firebase.initializeApp(config);
        return window.firebase;
      });
  }

  /** يرسم الحالة الحقيقية: مفعّل · غير مفعّل · الإذن مرفوض. */
  function renderState(permission) {
    var box = el('bell-push');
    if (!box) return;

    if (!('Notification' in window)) {
      box.hidden = false;
      setButton('غير مدعوم');
      note('متصفحك لا يدعم إشعارات الهاتف.');
      return;
    }
    if (permission === 'denied') {
      box.hidden = false;
      box.classList.add('is-on');
      setButton('الإذن مرفوض');
      note('فعّل الإشعارات من إعدادات الموقع في المتصفح ثم أعد تحميل الصفحة.');
      return;
    }
    if (state.enabled) {
      box.hidden = false;
      box.classList.add('is-on');
      setButton('إشعارات الهاتف مفعّلة');
      note('سيصلك إشعار على هذا الجهاز فور حدوثه.');
      return;
    }

    box.hidden = false;
    box.classList.remove('is-on');
    setButton('تفعيل إشعارات الهاتف');
    note(permission === 'granted' ? 'الإذن مُمنح — اضغط الزر لربط هذا الجهاز.' : 'يظهر إشعار على هاتفك فور حدوثه.');
  }

  function enable() {
    var button = el('push-toggle');
    if (button) button.disabled = true;
    setButton('جارٍ التفعيل…');
    note('');

    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== 'granted') {
          renderState(permission);
          return null;
        }
        return ensureWorker()
          .then(loadConfig)
          .then(function (config) {
            state.config = config;
            return loadFirebase(config);
          })
          .then(function () {
            return window.firebase.messaging().getToken({
              vapidKey: state.config.vapidKey || undefined,
              serviceWorkerRegistration: navigator.serviceWorker
            });
          })
          .then(function (token) {
            if (!token) throw new Error('لم يمنح المتصفح توكن إشعار — جرّب Chrome من جديد.');
            return post('/api/notifications/register', { token: token, platform: 'web' }).then(function (result) {
              if (result && result.ok === false) throw new Error(result.message || 'تعذّر حفظ الجهاز.');
              state.enabled = true;
              renderState('granted');
            });
          });
      })
      .catch(function (error) {
        renderState(Notification.permission);
        note(error.message || 'تعذّر تفعيل الإشعارات على هذا الجهاز.');
      })
      .then(function () {
        if (button) button.disabled = false;
      });
  }

  function disable() {
    setButton('جارٍ الإيقاف…');
    var token = '';
    if (window.firebase && window.firebase.messaging) {
      token = window.firebase.messaging().getToken().catch(function () {
        return '';
      });
    } else {
      token = Promise.resolve('');
    }

    token
      .then(function (value) {
        return value ? post('/api/notifications/unregister', { token: value }) : null;
      })
      .then(function () {
        if (window.firebase && window.firebase.messaging) {
          return window.firebase.messaging().deleteToken().catch(function () {});
        }
        return null;
      })
      .then(function () {
        state.enabled = false;
        renderState(Notification.permission);
      });
  }

  function init() {
    var box = el('bell-push');
    var button = el('push-toggle');
    if (!box || !button) return; // صفحة بلا جرس (لوحة landings مثلاً)

    button.addEventListener('click', function () {
      if (state.enabled) disable();
      else enable();
    });

    renderState('Notification' in window ? Notification.permission : 'unsupported');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // للتشخيص والاختبار فقط — لا تستعمله الواجهة.
  window.__zenaPush = { state: state, enable: enable, disable: disable };
})();
