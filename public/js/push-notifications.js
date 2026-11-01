/* eslint-disable no-undef */
/** Handles opt-in Firebase Cloud Messaging setup and reports unsupported configurations. */
(function () {
  'use strict';

  var SW_PATH = '/firebase-messaging-sw.js';
  var FIREBASE_VERSION = '10.12.2';

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
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('متصفحك لا يدعم الإشعارات.'));
    return navigator.serviceWorker.register(SW_PATH).then(function (registration) {
      console.info('[Zena Push] Service worker registered: ' + JSON.stringify({
        path: SW_PATH,
        registrationType: registration && registration.constructor && registration.constructor.name,
        isServiceWorkerRegistration: typeof ServiceWorkerRegistration !== 'undefined'
          && registration instanceof ServiceWorkerRegistration,
        scope: registration && registration.scope,
        activeState: registration && registration.active && registration.active.state,
        activeScriptURL: registration && registration.active && registration.active.scriptURL,
        installingState: registration && registration.installing && registration.installing.state,
        waitingState: registration && registration.waiting && registration.waiting.state,
        controllerScriptURL: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL
      }));
      return registration;
    }).catch(function (error) {
      console.error('[Zena Push] Service worker registration failed: ' + JSON.stringify({
        path: SW_PATH,
        errorName: error && error.name,
        message: error && error.message
      }));
      throw new Error('تعذّر تفعيل عامل الخدمة (Service Worker).');
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
      var app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
      messagingInstance = messagingSdk.getMessaging(app);
      return messagingInstance;
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
      note('متصفحك لا يدعم إشعارات الهاتف. جرّب Chrome أو Safari على هاتفك.');
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
    var activationStage = 'checking-browser';
    var workerRegistration = null;
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
        activationStage = 'notification-permission';
        if (permission !== 'granted') {
          renderState(permission);
          return null;
        }
        activationStage = 'service-worker-registration';
        return ensureWorker()
          .then(function (registration) {
            workerRegistration = registration;
            activationStage = 'firebase-config';
            return loadConfig().then(function (config) {
              state.config = config;
              activationStage = 'firebase-sdk-initialization';
              return loadFirebase(config).then(function () {
                return registration;
              });
            });
          })
          .then(function (registration) {
            activationStage = 'firebase-get-token';
            console.info('[Zena Push] Calling Firebase getToken: ' + JSON.stringify({
              firebaseVersion: FIREBASE_VERSION,
              registrationType: registration && registration.constructor && registration.constructor.name,
              isServiceWorkerRegistration: typeof ServiceWorkerRegistration !== 'undefined'
                && registration instanceof ServiceWorkerRegistration,
              scope: registration && registration.scope,
              activeState: registration && registration.active && registration.active.state,
              activeScriptURL: registration && registration.active && registration.active.scriptURL
            }));
            return messagingSdk.getToken(messagingInstance, {
              vapidKey: state.config.vapidKey || undefined,
              serviceWorkerRegistration: registration
            });
          })
          .then(function (token) {
            if (!token) throw new Error('لم يمنح المتصفح توكن إشعار — جرّب Chrome من جديد.');
            activationStage = 'saving-device-token';
            return post('/api/notifications/register', { token: token, platform: 'web' }).then(function (result) {
              if (result && result.ok === false) throw new Error(result.message || 'تعذّر حفظ الجهاز.');
              state.enabled = true;
              renderState('granted');
            });
          });
      })
      .catch(function (error) {
        var diagnostic = {
          stage: activationStage,
          errorName: error && error.name,
          errorMessage: error && error.message ? error.message : String(error),
          errorCode: error && error.code,
          errorStack: error && error.stack,
          firebaseVersion: FIREBASE_VERSION,
          permission: 'Notification' in window ? Notification.permission : 'unsupported',
          registrationType: workerRegistration && workerRegistration.constructor
            && workerRegistration.constructor.name,
          isServiceWorkerRegistration: typeof ServiceWorkerRegistration !== 'undefined'
            && workerRegistration instanceof ServiceWorkerRegistration,
          registrationScope: workerRegistration && workerRegistration.scope,
          activeScriptURL: workerRegistration && workerRegistration.active
            && workerRegistration.active.scriptURL
        };
        console.error('[Zena Push] Notification activation failed: ' + JSON.stringify(diagnostic));
        renderState(Notification.permission);
        note((error && error.message) || 'تعذّر تفعيل الإشعارات على هذا الجهاز.');
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
