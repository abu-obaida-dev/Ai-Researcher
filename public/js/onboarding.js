/**
 * فلترة لحظية لحقول صفحة إكمال الملف (onboarding) — تعمل بدون أي مكتبات:
 * 1) اسم المستخدم: حروف فقط (عربي/لاتيني) واسم واحد — تُحذف المسافات والأرقام والرموز فوراً.
 * 2) رقم الواتساب: أرقام فقط، يُقصّ حسب طول الدولة المختارة، وإن لُصق بمفتاح دولته يُقصّ المفتاح.
 *    مع تحديث المفتاح المعروض (+#) ونص التوضيح عند تغيير الدولة.
 * الخادم يعيد التحقق والتطبيع نفسه — هذه الفلترة تمنع الأخطاء قبل الإرسال فقط.
 */
(function () {
  'use strict';

  var nameInput = document.getElementById('full_name');
  if (nameInput) {
    // حذف أي شيء ليس حرفاً (يشمل المسافات) — اسم واحد فقط
    var filterName = function () {
      var cleaned = nameInput.value.replace(/[^\p{L}]/gu, '');
      if (cleaned !== nameInput.value) nameInput.value = cleaned;
    };
    nameInput.addEventListener('input', filterName);
    nameInput.addEventListener('blur', filterName);
    filterName(); // تنظيف القيمة الافتراضية (مثل اسم جوجل متعدد الكلمات) عند التحميل
  }

  var countrySelect = document.getElementById('wa_country');
  var numberInput = document.getElementById('whatsapp_number');
  var dialBadge = document.getElementById('wa_dial');
  var hintEl = document.getElementById('wa_hint');
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
        ' أرقام بعد المفتاح +' + country.dial + (country.sample ? ' (مثال: ' + country.sample + ')' : '') + '.';
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
