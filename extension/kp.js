// Работает во вкладке Кинопоиска: находит плеер, сообщает его состояние комнате,
// выполняет команды (пауза, запуск, перемотка) и показывает чат поверх фильма.
// Озвучку и субтитры каждый выбирает сам в плеере Кинопоиска — это не синхронизируется.

(() => {
  if (window.__vdvoemKp) return;
  window.__vdvoemKp = true;

  const supportedHosts = ['hd.kinopoisk.ru', 'gimobrimo.cfd', 'qqpoisk.ru'];
  const isSupported = supportedHosts.some(h => location.hostname.includes(h)) 
    || [...(location.ancestorOrigins ?? [])].some(o => supportedHosts.some(h => o.includes(h)));
  
  if (!isSupported) return;

  const send = (msg) => {
    try { chrome.runtime.sendMessage({ from: 'kp', ...msg }); } catch { /* расширение обновили */ }
  };

  // адрес страницы (фильм, сезон, серия) сообщает только верхний фрейм
  if (window === window.top) {
    let last = '';
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      send({ kind: 'page', url: location.href, title: document.title });
    }, 700);
    setInterval(() => send({ kind: 'page', url: location.href, title: document.title }), 5000);
  }

  // самое большое видео на странице — это фильм, а не превью
  function findVideo() {
    let best = null;
    let bestArea = 0;
    for (const video of document.querySelectorAll('video')) {
      const r = video.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = video; bestArea = area; }
    }
    return bestArea > 60000 ? best : null;
  }

  let video = null;
  let overlay = null; // чат появляется только во фрейме с фильмом
  setInterval(() => {
    video = findVideo();
    if (!video) return;
    overlay ??= makeOverlay();
    send({
      kind: 'state',
      state: {
        t: video.currentTime,
        paused: video.paused,
        buffering: video.seeking || (!video.paused && video.readyState < 3),
        ended: video.ended,
        rate: video.playbackRate || 1,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      },
    });
  }, 300);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.kind === 'command' && video) {
      if (msg.op === 'seek' && Number.isFinite(msg.t)) video.currentTime = msg.t;
      if (msg.op === 'play') video.play().catch(() => send({ kind: 'blocked' }));
      if (msg.op === 'pause') video.pause();
    }
    if (msg.kind === 'chat') overlay?.toast(msg.name, msg.text);
    if (msg.kind === 'notice') overlay?.toast('', msg.text);
  });

  // ----- чат поверх фильма -----

  function makeOverlay() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:18px;bottom:90px;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font: 15px/1.4 "Segoe UI", system-ui, sans-serif; }
        .toasts { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; max-width: 420px; }
        .toast { background: rgb(31 26 24 / .88); color: #f6ede2; border-radius: 16px; padding: 8px 13px;
          overflow-wrap: anywhere; animation: fade 8s forwards; }
        .toast b { color: #f2a687; margin-right: 6px; }
        @keyframes fade { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
        form { margin-top: 8px; pointer-events: auto; }
        input { width: 340px; max-width: 70vw; border: 1px solid #463b36; border-radius: 999px; padding: 9px 14px;
          background: rgb(31 26 24 / .94); color: #f6ede2; outline: none; }
        input:focus { border-color: #f2a687; }
        .hint { margin-top: 6px; color: #b5a498; font-size: 12px; background: rgb(31 26 24 / .7);
          border-radius: 10px; padding: 3px 9px; display: inline-block; }
      </style>
      <div class="toasts"></div>
      <form hidden><input maxlength="1000" placeholder="Сообщение, Esc — закрыть" autocomplete="off"></form>
      <div class="hint">Вдвоём: Enter — написать</div>`;
    const toasts = root.querySelector('.toasts');
    const form = root.querySelector('form');
    const input = root.querySelector('input');
    const hint = root.querySelector('.hint');
    setTimeout(() => { hint.hidden = true; }, 8000);

    // в полноэкранном режиме виден только развёрнутый элемент — переносим чат внутрь него
    const place = () => {
      const full = document.fullscreenElement;
      const parent = full && !(full instanceof HTMLVideoElement) ? full : document.documentElement;
      if (host.parentNode !== parent) parent.append(host);
    };
    document.addEventListener('fullscreenchange', place);
    place();

    function open() {
      form.hidden = false;
      input.focus();
    }
    function close() {
      form.hidden = true;
      input.value = '';
      input.blur();
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text) send({ kind: 'say', text });
      close();
    });
    // клавиши в поле ввода не должны управлять плеером Кинопоиска
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type === 'keydown' && event.key === 'Escape') close();
      });
    }
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !form.hidden || event.isComposing) return;
      const target = event.composedPath()[0];
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    }, true);

    return {
      toast(name, text) {
        place();
        const node = document.createElement('div');
        node.className = 'toast';
        if (name) {
          const author = document.createElement('b');
          author.textContent = name;
          node.append(author);
        }
        node.append(String(text).slice(0, 1000));
        toasts.append(node);
        while (toasts.children.length > 4) toasts.firstChild.remove();
        setTimeout(() => node.remove(), 8000);
      },
    };
  }
})();
