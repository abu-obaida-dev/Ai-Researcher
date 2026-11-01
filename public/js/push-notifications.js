/* eslint-disable no-undef */
/** Handles opt-in Firebase Cloud Messaging setup and reports unsupported configurations. */
(function () {
  'use strict';

  var SW_PATH = '/firebase-messaging-sw.js';
  var FIREBASE_VERSION = '10.12.2';
  var UNSUPPORTED_MESSAGE = 'عذرًا، لا يبدو أن هذا المتصفح أو الجهاز يدعم إشعارات الويب. جرّب متصفحًا حديثًا، وعلى iPhone أو iPad أضف الموقع إلى الشاشة الرئيسية أولًا.';

  var state = { enabled: false, config: null };
  var messagingSdk = null;
  var messagingInstance = null;

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

  /** Loads public Firebase configuration and rejects incomplete setup. */
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return Promise.reject(new Error(UNSUPPORTED_MESSAGE));
    }
    return navigator.serviceWorker.register(SW_PATH).catch(function () {
      throw new Error('تعذّر إعداد الإشعارات على هذا الجهاز. ' + UNSUPPORTED_MESSAGE);
    });
  }

  function loadFirebase(config) {
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-messaging.js')
    ]).then(function (modules) {
      var appSdk = modules[0];
      messagingSdk = modules[1];
      return messagingSdk.isSupported().then(function (supported) {
        if (!supported) throw new Error(UNSUPPORTED_MESSAGE);
        var app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
        messagingInstance = messagingSdk.getMessaging(app);
        return messagingInstance;
      });
    });
  }

  /** Renders the current notification-permission state. */
  function renderState(permission) {
    var box = el('bell-push');
    if (!box) return;

    if (!('Notification' in window)) {
      box.hidden = false;
      setButton('غير مدعوم');
      if (el('push-toggle')) el('push-toggle').disabled = true;
      note(UNSUPPORTED_MESSAGE);
      return;
    }
    if (permission === 'denied') {
      box.hidden = false;
      setButton('الإذن مرفوض');
      if (el('push-toggle')) el('push-toggle').disabled = true;
      note('الإشعارات محظورة من المتصفح. افتح إعدادات الموقع واسمح بالإشعارات ثم أعد تحميل الصفحة.');
      return;
    }
    if (state.enabled) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    if (el('push-toggle')) el('push-toggle').disabled = false;
    setButton(permission === 'granted' ? 'استكمال التفعيل' : 'تفعيل الإشعارات');
    note(permission === 'granted'
      ? 'باقي خطوة واحدة لربط هذا الجهاز واستقبال التنبيهات.'
      : 'فعّلها لتصلك تنبيهات المنصة على هاتفك حتى عندما لا تكون فاتحًا للموقع.');
  }

  function enable() {
    var button = el('push-toggle');
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') {
      note('افتح إعدادات الموقع في المتصفح واسمح بالإشعارات، ثم أعد تحميل الصفحة.');
      return;
    }
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
          .then(function (registration) {
            return loadConfig().then(function (config) {
              state.config = config;
              return loadFirebase(config).then(function () {
                return registration;
              });
            });
          })
          .then(function (registration) {
            return messagingSdk.getToken(messagingInstance, {
              vapidKey: state.config.vapidKey || undefined,
              serviceWorkerRegistration: registration
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
        var message = error && error.message;
        if (error && (error.name === 'AbortError' || error.code === 20)) {
          message = 'تعذّر الاتصال بخدمة الإشعارات لهذا الجهاز. قد لا يدعمها المتصفح أو النظام، أو قد تكون الخدمة محجوبة مؤقتًا. '
            + UNSUPPORTED_MESSAGE;
        }
        note(message || 'تعذّر تفعيل الإشعارات على هذا الجهاز.');
      })
      .then(function () {
        if (button) button.disabled = Notification.permission === 'denied';
      });
  }

  function disable() {
    setButton('جارٍ الإيقاف…');
    var token = '';
    if (messagingSdk && messagingInstance) {
      token = messagingSdk.getToken(messagingInstance).catch(function () {
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
        if (messagingSdk && messagingInstance) {
          return messagingSdk.deleteToken(messagingInstance).catch(function () {});
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
    if (!box || !button) return;

    try {
      if (sessionStorage.getItem('zena-push-dismissed') === '1') return;
    } catch (_) {}

    button.addEventListener('click', function () {
      enable();
    });
    var dismiss = el('push-dismiss');
    if (dismiss) dismiss.addEventListener('click', function () {
      box.hidden = true;
      try {
        sessionStorage.setItem('zena-push-dismissed', '1');
      } catch (_) {}
    });

    renderState('Notification' in window ? Notification.permission : 'unsupported');
    fetch('/api/notifications', { headers: { accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (result) {
        if (result && result.ok && result.devices > 0) {
          state.enabled = true;
          box.hidden = true;
        }
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Used for diagnostics and tests; not called by the UI.
  window.__zenaPush = { state: state, enable: enable, disable: disable };
})();
