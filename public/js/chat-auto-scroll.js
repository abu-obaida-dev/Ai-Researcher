/** Scrolls chat messages to the bottom while keeping reference-panel scrolling independent. */
(function scrollChatToBottom() {
  var box = document.getElementById('messages');
  if (!box) return;
  box.scrollTop = box.scrollHeight;

  // Keep the conversation stationary when the independent references panel opens.
  var refs = document.getElementById('chat-refs');
  if (!refs) return;
  refs.setAttribute('data-refs-wired', '1');
  refs.addEventListener('toggle', function () {
    refs.scrollTop = refs.open ? 0 : refs.scrollHeight;
  });
})();
