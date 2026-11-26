// Два плеера с общим интерфейсом:
// time(), state(): 'playing' | 'paused' | 'buffering' | 'ended' | 'idle',
// play(), pause(), seek(t), destroy()

import { loadScript } from './load.js';

let youtubeApi;
function loadYoutubeApi() {
  youtubeApi ??= new Promise((resolve, reject) => {
    const fail = () => { youtubeApi = undefined; reject(new Error('youtube')); };
    const timer = setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT); };
    loadScript('https://www.youtube.com/iframe_api').catch(() => { clearTimeout(timer); fail(); });
  });
  return youtubeApi;
}

export async function createYoutube(container, id, start, onError) {
  const YT = await loadYoutubeApi();
  const slot = document.createElement('div');
  container.replaceChildren(slot);

  const player = await new Promise((resolve) => {
    const instance = new YT.Player(slot, {
      videoId: id,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, fs: 0, start: Math.floor(start), origin: location.origin },
      events: {
        onReady: () => resolve(instance),
        onError: ({ data }) => {
          onError(data === 101 || data === 150
            ? 'YouTube не отдаёт это видео сторонним сайтам: запрет автора или проверка YouTube.'
            : 'YouTube не смог открыть это видео.');
          resolve(instance);
        },
      },
    });
  });

  let cuedAt = start;
  const raw = () => player.getPlayerState?.() ?? -1;
  const untouched = () => raw() === -1 || raw() === 5;

  return {
    time: () => (untouched() ? cuedAt : player.getCurrentTime?.() ?? 0),
    state: () => ({ 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering' }[raw()] ?? 'idle'),
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek(t) {
      if (untouched()) { cuedAt = t; player.cueVideoById({ videoId: id, startSeconds: t }); }
      else player.seekTo(t, true);
    },
    destroy: () => player.destroy(),
  };
}

export async function createVideo(container, source, start, onError) {
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('controlslist', 'nofullscreen nodownload noremoteplayback');
  container.replaceChildren(video);

  const isFile = source instanceof File;
  const address = isFile ? URL.createObjectURL(source) : source;
  let hls;

  video.addEventListener('error', () => onError(isFile
    ? 'Браузер не умеет проигрывать этот файл. Надёжнее всего mp4 (H.264 + AAC).'
    : 'Не получилось открыть видео по этой ссылке.'));

  const isStream = !isFile && /\.m3u8$/i.test(new URL(address).pathname);
  if (isStream && !video.canPlayType('application/vnd.apple.mpegurl')) {
    await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js');
    hls = new window.Hls();
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal) onError('Поток не открылся: сайт с видео не разрешает смотреть его отсюда или ссылка устарела.');
    });
    hls.loadSource(address);
    hls.attachMedia(video);
  } else {
    video.src = address;
  }

  await new Promise((resolve) => {
    if (video.readyState >= 1) return resolve();
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 15000);
  });
  if (start) video.currentTime = start;

  return {
    element: video,
    time: () => video.currentTime,
    state() {
      if (video.ended) return 'ended';
      if (video.seeking || (!video.paused && video.readyState < 3)) return 'buffering';
      return video.paused ? 'paused' : 'playing';
    },
    play: () => video.play().catch(() => {}),
    pause: () => video.pause(),
    seek: (t) => { video.currentTime = t; },
    destroy() {
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
      video.remove();
      if (isFile) URL.revokeObjectURL(address);
    },
  };
}

// Кинопоиск: сам фильм идёт во вкладке Кинопоиска, а здесь — карточка и «пульт».
// Команды и состояние ходят через расширение «Вдвоём — Кинопоиск» (ext.js).
export function createKinopoisk(container, media, start, { ext, onReady }) {
  const card = document.createElement('div');
  card.className = 'kp-card';
  card.innerHTML = `
    <h2>Смотрим на Кинопоиске</h2>
    <p class="kp-title"></p>
    <p class="kp-status"></p>
    <button class="primary" type="button">Открыть Кинопоиск</button>
    <p class="kp-hint">Пауза, перемотка и серии общие. Озвучку и субтитры каждый выбирает у себя в плеере Кинопоиска.
      Чат виден прямо поверх фильма: Enter — написать.</p>`;
  container.replaceChildren(card);
  const title = card.querySelector('.kp-title');
  const status = card.querySelector('.kp-status');

  let last = null;   // последнее состояние плеера из вкладки Кинопоиска
  let connected = false;
  const fresh = () => last && performance.now() - last.at < 2500;

  card.querySelector('button').addEventListener('click', () => {
    if (ext.ready) ext.send({ kind: 'open', url: media.url });
    else window.open(media.url, '_blank', 'noopener');
  });

  function render() {
    if (!ext.ready) {
      status.textContent = 'Нужно расширение «Вдвоём — Кинопоиск» у вас обоих (инструкция в README). Без него можно включить фильм вручную и запустить вместе кнопкой 3·2·1.';
    } else if (!fresh()) {
      status.textContent = 'Откройте фильм во вкладке Кинопоиска и включите его — дальше всё общее.';
    } else {
      const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      status.textContent = `Подключено · ${mm(last.t)}${last.duration ? ' из ' + mm(last.duration) : ''}${last.paused ? ' · пауза' : ''}`;
    }
  }

  const off = ext.on((msg) => {
    if (msg.kind === 'state' && msg.state && Number.isFinite(msg.state.t)) {
      last = { ...msg.state, at: performance.now() };
      if (!connected) {
        connected = true;
        onReady?.(); // вкладка подключилась — подтягиваем её к общему времени
      }
    }
    if (msg.kind === 'page' && typeof msg.title === 'string') {
      title.textContent = msg.title.replace(/\s*[—|-]\s*Кинопоиск.*$/i, '');
    }
    render();
  });
  const timer = setInterval(() => {
    if (connected && !fresh()) connected = false;
    render();
  }, 1000);
  render();

  return {
    time() {
      if (!last) return start;
      const moving = !last.paused && !last.buffering && !last.ended;
      return last.t + (moving ? ((performance.now() - last.at) / 1000) * (last.rate || 1) : 0);
    },
    state() {
      if (!fresh()) return 'buffering'; // вкладки нет — ничего не решаем за человека
      if (last.ended) return 'ended';
      if (last.buffering) return 'buffering';
      return last.paused ? 'paused' : 'playing';
    },
    play: () => ext.send({ kind: 'command', op: 'play' }),
    pause: () => ext.send({ kind: 'command', op: 'pause' }),
    seek(t) {
      ext.send({ kind: 'command', op: 'seek', t });
      if (last) last = { ...last, t, at: performance.now() };
    },
    destroy() {
      off();
      clearInterval(timer);
      card.remove();
    },
  };
}

// Зеркала (gimobrimo.cfd и др.) — используем ту же логику, что и для Кинопоиска
export function createMirror(container, media, start, { ext, onReady }) {
  const card = document.createElement('div');
  card.className = 'kp-card';
  card.innerHTML = `
    <h2>Смотрим на зеркале</h2>
    <p class="kp-title">${new URL(media.url).hostname}</p>
    <p class="kp-status"></p>
    <button class="primary" type="button">Открыть видео</button>
    <p class="kp-hint">Пауза, перемотка и серии общие. Озвучку и субтитры каждый выбирает у себя.
      Чат виден прямо поверх фильма: Enter — написать.</p>`;
  container.replaceChildren(card);
  const status = card.querySelector('.kp-status');

  let last = null;
  let connected = false;
  const fresh = () => last && performance.now() - last.at < 2500;

  card.querySelector('button').addEventListener('click', () => {
    if (ext.ready) ext.send({ kind: 'open', url: media.url });
    else window.open(media.url, '_blank', 'noopener');
  });

  function render() {
    if (!ext.ready) {
      status.textContent = 'Нужно расширение «Вдвоём» у вас обоих. Без него видео откроется, но синхронизации не будет.';
    } else if (!fresh()) {
      status.textContent = 'Откройте видео в новой вкладке и включите его — дальше всё общее.';
    } else {
      const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      status.textContent = `Подключено · ${mm(last.t)}${last.duration ? ' из ' + mm(last.duration) : ''}${last.paused ? ' · пауза' : ''}`;
    }
  }

  const off = ext.on((msg) => {
    if (msg.kind === 'state' && msg.state && Number.isFinite(msg.state.t)) {
      last = { ...msg.state, at: performance.now() };
      if (!connected) {
        connected = true;
        onReady?.();
      }
    }
    render();
  });
  const timer = setInterval(() => {
    if (connected && !fresh()) connected = false;
    render();
  }, 1000);
  render();

  return {
    time() {
      if (!last) return start;
      const moving = !last.paused && !last.buffering && !last.ended;
      return last.t + (moving ? ((performance.now() - last.at) / 1000) * (last.rate || 1) : 0);
    },
    state() {
      if (!fresh()) return 'buffering';
      if (last.ended) return 'ended';
      if (last.buffering) return 'buffering';
      return last.paused ? 'paused' : 'playing';
    },
    play: () => ext.send({ kind: 'command', op: 'play' }),
    pause: () => ext.send({ kind: 'command', op: 'pause' }),
    seek(t) {
      ext.send({ kind: 'command', op: 'seek', t });
      if (last) last = { ...last, t, at: performance.now() };
    },
    destroy() {
      off();
      clearInterval(timer);
      card.remove();
    },
  };
}