// Мост между страницей «Вдвоём» и расширением. Работает только на сайте с меткой vdvoem.

(() => {
  const ORIGIN = location.origin;
  const toPage = (msg) => window.postMessage({ vdvoem: 'from-ext', msg }, ORIGIN);
  const toExtension = (msg) => {
    try { chrome.runtime.sendMessage({ from: 'site', ...msg }); } catch { /* расширение обновили — нужна перезагрузка страницы */ }
  };

  function start() {
    if (!document.querySelector('meta[name="vdvoem"]')) return;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.vdvoem !== 'to-ext') return;
      const msg = event.data.msg;
      if (msg?.kind === 'ping') return toPage({ kind: 'ready' });
      toExtension(msg);
    });
    chrome.runtime.onMessage.addListener((msg) => toPage(msg));
    toPage({ kind: 'ready' });
    // фоновый скрипт расширения засыпает: регулярно напоминаем, где комната
    toExtension({ kind: 'hello' });
    setInterval(() => toExtension({ kind: 'hello' }), 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
