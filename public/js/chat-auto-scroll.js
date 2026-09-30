/**
 * تمرير صندوق المحادثة إلى آخر رسالة عند فتح الصفحة.
 * تحسين بحت: الصفحة تعمل بدون هذا الملف، لأن كل الإرسال عبر نماذج HTML عادية.
 */
(function scrollChatToBottom() {
  var box = document.getElementById('messages');
  if (!box) return;
  box.scrollTop = box.scrollHeight;
})();
