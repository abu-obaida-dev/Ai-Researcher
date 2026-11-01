(function () {
  'use strict';

  document.querySelectorAll('form[data-literature-search]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var query = form.querySelector('[name="wq"]');
      if (!query || !query.value.trim()) return;

      var progress = form.querySelector('[data-search-progress]');
      var button = form.querySelector('button[type="submit"]');
      if (progress) progress.hidden = false;
      if (button) button.disabled = true;
    });
  });
})();