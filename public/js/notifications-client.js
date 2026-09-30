/**
 * منطق صفحة الإشعارات: تسجيل Service Worker + الحصول على توكن FCM وإرساله
 * إلى الخادم (POST /api/notifications/register) — لا مفاتيح سرّية هنا إطلاقاً.
 * يقرأ عناصر الصفحة: push-status / device-count / btn-enable-push /
 * btn-disable-push / btn-read-all / [data-read-id].
 */
(function () {
  'use strict';

  var SW_URL = '/firebase-messaging-sw.js';
  var config = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    var el = $('push-status');
    if (el) el.textContent = message;
  }

  /** رسالة عربية قصيرة تظهر في أسفل الصفحة ثم تختفي. */
  function toast(message) {
    var el = document.createElement('div');
    el.className = 'zena-toast';
    el.textContent = message;
    el.style.cssText =
      'position:fixed;bottom:18px;inset-inline-start:18px;background:#102A43;color:#fff;padding:11px 16px;' +
      'border-radius:12px;font-size:13px;font-weight:600;z-index:99;box-shadow:0 8px 24px rgba(16,42,67,.25);';
    document.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3500);
  }

  /** POST JSON بنفس نطاق الموقع مع ترجمة الخطأ إلى استثناء برسالة عربية. */
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || data.ok === false) {
          throw new Error(data.message || 'تعذّر تنفيذ الطلب.');
        }
        return data;
      });
    });
  }

  function updateDeviceCount(count) {
    var el = $('device-count');
    if (el && typeof count !== 'undefined') el.textContent = String(count);
  }

  /** يجلب إعدادات Firebase العامة ثم يهيّئ المكتبة إن كانت جاهزة. */
  function loadConfig() {
    return fetch('/api/firebase-config', { credentials: 'same-origin' })
      .then(function (response) {
        return response.json();
      })
      .then(function (cfg) {
        config = cfg;
        if (cfg && cfg.configured && typeof firebase !== 'undefined' && !firebase.apps.length) {
          firebase.initializeApp({
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            storageBucket: cfg.storageBucket,
            messagingSenderId: cfg.messagingSenderId,
            appId: cfg.appId
          });
        }
        return cfg;
      });
  }

  /** يسجّل Service Worker (أو يستخدم المسجّل سابقاً) ويعيد كائن التسجيل. */
  function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return Promise.reject(new Error('متصفحك لا يدعم Service Worker.'));
    }
    return navigator.serviceWorker.register(SW_URL, { scope: '/' });
  }

  /** يعيد توكن هذا الجهاز الحالي إن وُجد (أو null). */
  function getExistingToken(registration) {
    return firebase.messaging().getToken({
      vapidKey: config && config.vapidKey ? config.vapidKey : undefined,
      serviceWorkerRegistration: registration
    });
  }

  /** الحالة عند فتح الصفحة: لو كان الجهاز مفعّلاً سابقاً نحدّث عدّاد الأجهزة. */
  function refreshState() {
    if (typeof firebase === 'undefined' || !firebase.apps.length || !config || !config.configured) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    ensureServiceWorker()
      .then(getExistingToken)
      .then(function (existing) {
        if (!existing) return null;
        return postJSON('/api/notifications/register', { token: existing, platform: 'web' });
      })
      .then(function (data) {
        if (data) updateDeviceCount(data.devices);
      })
      .catch(function () {
        /* صامت — الصفحة تعمل حتى بدون push */
      });
  }

  /** زر «تفعيل على هذا الجهاز»: إذن → توكن FCM → حفظه عند الخادم. */
  function enable() {
    if (typeof firebase === 'undefined' || !firebase.apps.length || !config || !config.configured) {
      setStatus('الإعدادات غير جاهزة: أضف مفاتيح FIREBASE_* في ملف .env وأعد تشغيل الخادم.');
      return;
    }
    if (!('Notification' in window)) {
      setStatus('متصفحك لا يدعم الإشعارات.');
      return;
    }

    setStatus('...جارٍ طلب إذن الإشعارات');
    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== 'granted') {
          setStatus('لم يُسمح بإشعارات هذا المتصفح — يمكنك السماح من إعدادات الموقع في المتصفح.');
          return null;
        }
        return ensureServiceWorker()
          .then(getExistingToken)
          .then(function (token) {
            if (!token) throw new Error('تعذّر الحصول على توكن الإشعارات من FCM.');
            return postJSON('/api/notifications/register', { token: token, platform: 'web' });
          })
          .then(function (data) {
            updateDeviceCount(data.devices);
            setStatus('تم التفعيل على هذا الجهاز — ستصلك الإشعارات حتى لو كان الموقع مغلقاً.');
            toast('تم تفعيل إشعارات الهاتف ✔');
          });
      })
      .catch(function (error) {
        setStatus('تعذّر التفعيل: ' + error.message);
      });
  }

  /** زر «إيقاف على هذا الجهاز». */
  function disable() {
    if (typeof firebase === 'undefined' || !firebase.apps.length) {
      setStatus('لا يوجد توكن مسجّل على هذا الجهاز.');
      return;
    }

    setStatus('...جارٍ إيقاف هذا الجهاز');
    ensureServiceWorker()
      .then(getExistingToken)
      .then(function (token) {
        if (!token) return null;
        return postJSON('/api/notifications/unregister', { token: token });
      })
      .then(function (data) {
        if (data) {
          updateDeviceCount(data.devices);
          setStatus('أُوقفت إشعارات هذا الجهاز.');
        } else {
          setStatus('لا يوجد توكن مسجّل على هذا الجهاز.');
        }
      })
      .catch(function (error) {
        setStatus('تعذّر الإيقاف: ' + error.message);
      });
  }

  /** أزرار «تعليم كمقروء» (فردي + الكل). */
  function wireReadButtons() {
    var readAll = $('btn-read-all');
    if (readAll) {
      readAll.addEventListener('click', function () {
        postJSON('/api/notifications/read-all')
          .then(function () {
            window.location.reload();
          })
          .catch(function (error) {
            toast(error.message);
          });
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-read-id]'), function (button) {
      button.addEventListener('click', function () {
        postJSON('/api/notifications/' + button.getAttribute('data-read-id') + '/read')
          .then(function () {
            var item = button.closest('.notif-item');
            if (item) item.classList.remove('notif-unread');
            button.remove();
          })
          .catch(function (error) {
            toast(error.message);
          });
      });
    });
  }

  /** رسالة push وصلت والصفحة مفتوحة → تنبيه ثم تحديث القائمة. */
  function listenForForegroundPush() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'zena:push') {
        var push = event.data.push || {};
        toast(push.title || 'إشعار جديد من Zena AI');
        setTimeout(function () {
          window.location.reload();
        }, 1200);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var enableButton = $('btn-enable-push');
    var disableButton = $('btn-disable-push');
    if (enableButton) enableButton.addEventListener('click', enable);
    if (disableButton) disableButton.addEventListener('click', disable);
    wireReadButtons();
    listenForForegroundPush();
    loadConfig()
      .then(refreshState)
      .catch(function () {
        /* تُظهر الصفحة تلميح الحالة بدل إظهار خطأ تقني */
      });
  });
})();