/**
 * منتقي الملف في صفحة «ملفاتى»: يعرض اسم الملف وحجمه بعد الاختيار،
 * ويبرز منطقة الإفلات أثناء السحب.
 * تحسين اختياري — الرفع يعمل بدون هذا الملف: الـ input حقيقي مغطّى بالكامل
 * فوق البطاقة (opacity:0) والرابط label قياسي يفتحه بالنقر.
 */
(function initFilePicker() {
  var input = document.getElementById('file_input');
  var nameBox = document.getElementById('file-picked-name');
  if (!input) return;

  /** حجم مقروء: KB / MB. */
  function humanSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' بايت';
  }

  function showPicked() {
    if (!nameBox) return;
    var file = input.files && input.files[0];
    nameBox.textContent = file ? 'تم اختيار: ' + file.name + ' · ' + humanSize(file.size) : '';
  }

  input.addEventListener('change', showPicked);

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
