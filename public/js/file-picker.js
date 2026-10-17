/**
 * منتقي الملف في صفحة «ملفاتى»: يعرض اسم الملف وحجمه بعد الاختيار،
 * ويبرز منطقة الإفلات أثناء السحب، ويرفض مبكراً (قبل الإرسال) الملف
 * بنوع غير مدعوم أو حجم أكبر من حدّ الباقة أو لا يتسع له ما تبقّى
 * من المساحة — برسالة عربية واضحة في موضع الرفض نفسه.
 * ملاحظة: الرفض هنا تحسين تجربة فوري؛ الخادم يعيد التحقق دائماً.
 */
(function initFilePicker() {
  var input = document.getElementById('file_input');
  var nameBox = document.getElementById('file-picked-name');
  if (!input) return;

  var form = input.form;
  var errorBox = document.getElementById('file-upload-error');
  var maxMb = Number(input.getAttribute('data-max-mb') || 0);
  var allowed = (input.getAttribute('data-allowed-ext') || '').split(',').filter(Boolean);
  var remaining = Number(input.getAttribute('data-remaining-bytes') || 0);

  /** حجم مقروء: KB / MB. */
  function humanSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' بايت';
  }

  function showError(message) {
    if (errorBox) {
      errorBox.textContent = message || '';
      errorBox.hidden = !message;
    }
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function extensionOf(name) {
    var index = String(name || '').lastIndexOf('.');
    return index > -1 ? String(name).slice(index + 1).toLowerCase() : '';
  }

  /** يعرض سبب الرفض (إن وُجد) — true = الملف صالح. */
  function validate(file) {
    if (!file) {
      showError('');
      return true;
    }
    var ext = extensionOf(file.name);
    if (allowed.length && allowed.indexOf(ext) === -1) {
      showError(
        'النوع غير مدعوم: ' + (ext ? '.' + ext : 'ملف بلا امتداد') + ' — الأنواع المسموحة فقط: ' +
          allowed.map(function (entry) { return '.' + entry; }).join(' · ') + '.'
      );
      return false;
    }
    if (maxMb > 0 && file.size > maxMb * 1048576) {
      showError('الحجم أكبر من الحد المسموح: ' + humanSize(file.size) + ' — الحد في باقتك ' + maxMb + ' MB.');
      return false;
    }
    if (remaining > 0 && file.size > remaining) {
      showError(
        'الحجم أكبر من المساحة المتبقية: المتبقي ' + humanSize(remaining) + ' فقط — احذف ملفات أو احجز مساحة أكبر.'
      );
      return false;
    }
    showError('');
    return true;
  }

  function showPicked() {
    var file = input.files && input.files[0];
    validate(file);
    if (nameBox) {
      nameBox.textContent = file ? 'تم اختيار: ' + file.name + ' · ' + humanSize(file.size) : '';
    }
  }

  input.addEventListener('change', showPicked);

  // خط الدفاع الأخير: لا نرسل النموذج بملف مرفوض حتى لو تعطّل سبب آخر.
  if (form) {
    form.addEventListener('submit', function (event) {
      var file = input.files && input.files[0];
      if (file && !validate(file)) {
        event.preventDefault();
        showError(
          (errorBox && errorBox.textContent) || 'تعذّر الرفع — تحقق من نوع الملف وحجمه.'
        );
      }
    });
  }

  ['dragenter', 'dragover'].forEach(function (type) {
    input.addEventListener(type, function (event) {
      event.preventDefault();
      input.classList.add('dragging');
    });
  });

  ['dragleave', 'drop', 'dragend'].forEach(function (type) {
    input.addEventListener(type, function (event) {
      event.preventDefault();
      input.classList.remove('dragging');
    });
  });

  if (input.files && input.files.length) showPicked();
})();
