/**
 * فلترة لحظية لحقل واتساب صفحة الدفع — نفس منطق صفحة التسجيل (onboarding.js):
 * أرقام فقط، يُقصّ حسب طول الدولة المختارة، وإن لُصق بمفتاح دولته يُقصّ المفتاح،
 * مع تحديث المفتاح المعروض (+#) ونص التوضيح عند تغيير الدولة.
 * المعرّفات هنا ببادئة pay- حتى لا تتعارض مع حقول التسجيل.
 */
(function () {
  'use strict';

  var countrySelect = document.getElementById('pay-wa-country');
  var numberInput = document.getElementById('pay-whatsapp');
  var dialBadge = document.getElementById('pay-wa-dial');
  var hintEl = document.getElementById('pay-wa-hint');
  if (!countrySelect || !numberInput) return;

  /** خصائص الدولة الحالية من خيارات القائمة (data-* مضمّنة في HTML). */
  function currentCountry() {
    var option = countrySelect.options[countrySelect.selectedIndex];
    if (!option) return { dial: '218', lengths: [9], name: 'ليبيا', sample: '912345678' };
    return {
      dial: option.getAttribute('data-dial') || '',
      lengths: (option.getAttribute('data-lengths') || '9').split(',').map(Number),
      name: option.textContent.replace(/\s*\(\+\d+\)\s*$/, '').trim(),
      sample: option.getAttribute('data-sample') || ''
    };
  }

  /** تطبيع الرقم: أرقام فقط + قصّ المفتاح الملصوق إن وُجد + حذف الأصفار البادئة + حذف الزائد. */
  function sanitizeNumber(raw, country) {
    var digits = String(raw).replace(/\D/g, '');
    if (digits.slice(0, 2) === '00') digits = digits.slice(2); // صيغة 00
    if (country.dial && digits.indexOf(country.dial) === 0) {
      var withoutDial = digits.slice(country.dial.length);
      if (country.lengths.indexOf(withoutDial.length) !== -1) digits = withoutDial; // مفتاح ملصوق فقط
    }
    digits = digits.replace(/^0+(?=\d)/, ''); // الصفر المحلي البادئ (091… ← 91…)
    var maxLength = Math.max.apply(null, country.lengths);
    if (digits.length > maxLength) digits = digits.slice(0, maxLength);
    return digits;
  }

  /** تحديث المفتاح المعروض + maxlength + placeholder + نص التوضيح حسب الدولة. */
  function syncCountry() {
    var country = currentCountry();
    if (dialBadge) dialBadge.textContent = '+' + country.dial;
    numberInput.maxLength = Math.max.apply(null, country.lengths);
    numberInput.setAttribute('data-lengths', country.lengths.join(','));
    if (country.sample) numberInput.placeholder = country.sample;
    if (hintEl) {
      hintEl.textContent =
        'الرقم المطلوب لدولة ' + country.name + ': ' + country.lengths.join(' أو ') +
        ' أرقام بعد المفتاح +' + country.dial + (country.sample ? ' (مثال: ' + country.sample + ')' : '') +
        '. سيظهر لك كود تفعيل من 6 أرقام بعد الإرسال — أرسله عبر واتساب لخدمة العملاء.';
    }
    // إعادة تطبيع القيمة الحالية عند تغيير الدولة (طولها قد يصبح غير صالح)
    var cleaned = sanitizeNumber(numberInput.value, country);
    if (cleaned !== numberInput.value) numberInput.value = cleaned;
  }

  countrySelect.addEventListener('change', syncCountry);
  numberInput.addEventListener('input', function () {
    var cleaned = sanitizeNumber(numberInput.value, currentCountry());
    if (cleaned !== numberInput.value) numberInput.value = cleaned;
  });
  numberInput.addEventListener('blur', function () {
    var cleaned = sanitizeNumber(numberInput.value, currentCountry());
    if (cleaned !== numberInput.value) numberInput.value = cleaned;
  });

  syncCountry();
})();
