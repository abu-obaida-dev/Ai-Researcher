/* eslint-disable no-undef */
/** Initializes Firebase Analytics on public pages only. */
(function () {
  'use strict';

  var version = '10.12.2';
  var base = 'https://www.gstatic.com/firebasejs/' + version + '/';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('Failed to load Firebase Analytics SDK.'));
      };
      document.head.appendChild(script);
    });
  }

  fetch('/api/firebase-config', { headers: { accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('Firebase configuration request failed.');
      return response.json();
    })
    .then(function (config) {
      if (!config || !config.configured || !config.measurementId) return null;
      return loadScript(base + 'firebase-app-compat.js')
        .then(function () {
          return loadScript(base + 'firebase-analytics-compat.js');
        })
        .then(function () {
          if (!window.firebase) throw new Error('Firebase SDK did not initialize.');
          if (!window.firebase.apps.length) window.firebase.initializeApp(config);
          window.firebase.analytics();
        });
    })
    .catch(function (error) {
      console.warn('Firebase Analytics could not be initialized:', error.message);
    });
})();
