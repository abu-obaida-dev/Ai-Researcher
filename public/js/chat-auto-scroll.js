/**
 * تمرير صندوق المحادثة إلى آخر رسالة عند فتح الصفحة.
 * تحسين بحت: الصفحة تعمل بدون هذا الملف، لأن كل الإرسال عبر نماذج HTML عادية.
 *
 * ملاحظة: نستثني لوحة المراجع القابلة للطيّ (.chat-refs) لأنها عنصر مستقل
 * له تمريره الخاص؛ تمريرها معه كان يزيح الحوار لأسفل عند فتحها.
 */
(function scrollChatToBottom() {
  var box = document.getElementById('messages');
  if (!box) return;
  box.scrollTop = box.scrollHeight;

  // فتح لوحة المراجع يمرّرها هي فقط، ويُبقي الحوار في مكانه.
  // نضع علامة الترابط حتى لا يُعيد chat-send.js ربط مستمع ثانٍ على العنصر نفسه.
  var refs = document.getElementById('chat-refs');
  if (!refs) return;
  refs.setAttribute('data-refs-wired', '1');
  refs.addEventListener('toggle', function () {
    refs.scrollTop = refs.open ? 0 : refs.scrollHeight;
  });
})();
