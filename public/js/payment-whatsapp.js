/** Normalizes the payment WhatsApp number using payment-specific field IDs. */
(function () {
  'use strict';

  var countrySelect = document.getElementById('pay-wa-country');
  var numberInput = document.getElementById('pay-whatsapp');
  var dialBadge = document.getElementById('pay-wa-dial');
  var hintEl = document.getElementById('pay-wa-hint');
  if (!countrySelect || !numberInput) return;

  /** Reads the selected country's metadata from its option element. */
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

  /** Normalizes the number and removes a pasted country code when present. */
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

  /** Updates the displayed calling code and field hints. */
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
    // Revalidate the current number when the selected country changes.
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
