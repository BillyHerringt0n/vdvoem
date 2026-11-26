import { parseLink, cleanMedia, mediaKey, clock } from './links.js';
import { openChannel, randomId } from './net.js';
import { createYoutube, createVideo, createKinopoisk } from './players.js';
import { ext } from './ext.js';
import { createTimeline, createFollower } from './sync.js';
import { mergeList, edit, waiting } from './list.js';
import { REACTIONS, HUG, HOOKAH, CAT, picture, fly, prepareHookah, showHookah, countdown } from './fun.js';
import { createCat, randomSpot } from './cat.js';
import { createEnhancer, MODES } from './upscale.js';

const $ = (id) => document.getElementById(id);

const BEAT_MS = 3000;
const PEER_TIMEOUT_MS = 10000;
const HISTORY = 200;

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ } },
};

// id свой у каждой вкладки и переживает перезагрузку
let me;
try {
  me = sessionStorage.getItem('vd.me') || randomId(8);
  sessionStorage.setItem('vd.me', me);
} catch { me = randomId(8); }

const roomFromHash = () => new URLSearchParams(location.hash.slice(1)).get('room');

// ---------- вход ----------

$('name').value = store.get('vd.name', '');
const lastRoom = store.get('vd.last', null);
if (roomFromHash()) {
  $('join-btn').textContent = 'Войти в комнату';
  $('lobby-text').textContent = 'Вас ждут: смотрим вместе.';
} else if (lastRoom) {
  $('join-btn').textContent = 'Вернуться в нашу комнату';
  $('new-room').hidden = false;
}

function enter(fresh) {
  const name = $('name').value.trim();
  if (!name) return $('name').focus();
  store.set('vd.name', name);
  let room = roomFromHash() || (!fresh && lastRoom);
  if (!room) room = randomId(16);
  if (!roomFromHash()) history.replaceState(null, '', '#room=' + room);
  store.set('vd.last', room);
  $('lobby').hidden = true;
  $('room').hidden = false;
  start(name, room).catch((error) => {
    console.error(error);
    setStatus('Не получилось подключиться. Обновите страницу.', 'bad');
  });
}

$('join-form').addEventListener('submit', (event) => { event.preventDefault(); enter(false); });
$('new-room').addEventListener('click', () => enter(true));

// открыли другую ссылку-приглашение в той же вкладке
addEventListener('hashchange', () => location.reload());

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('dot').className = 'dot ' + kind;
}

// ---------- комната ----------

async function start(name, room) {
  const peers = new Map();
  const timeline = createTimeline(me);
  const savedKey = 'vd.room.' + room;
  const chatKey = 'vd.chat.' + room;
  let messages = store.get(chatKey, []);
  let channel;
  let online = 0;
  let loadedKey = '';
  let loadToken = 0;
  let localFile = null;      // { key, file }
  let unread = 0;
  let noticeTimer;
  let enhancer = null;
  let enhanceMode = store.get('vd.enhance', 'off');
  if (!Object.hasOwn(MODES, enhanceMode)) enhanceMode = 'off';

  const follower = createFollower(timeline, {
    publish(patch, action) {
      timeline.local(patch);
      sendState(action);
      addEvent(describe(action, patch.pos, 'Вы'));
    },
    onBlocked(blocked) { $('tap').hidden = !blocked; },
  });

  const latencyOf = (id) => (peers.get(id)?.rtt ?? 300) / 2000;

  function send(message) {
    return channel?.send({ ...message, from: me, name });
  }

  function sendState(action) {
    send({ type: 'state', state: timeline.snapshot(), action });
    remember();
  }

  function remember() {
    const { media } = timeline.state;
    if (media && media.type !== 'file') store.set(savedKey, { media, pos: timeline.position() });
  }

  function describe(action, pos, who) {
    const what = {
      play: 'запуск', pause: 'пауза', seek: 'перемотка на ' + clock(pos ?? 0), media: 'новое видео',
    }[action];
    return what ? `${who}: ${what}` : '';
  }

  // ----- видео -----

  function notice(text, sticky = false) {
    clearTimeout(noticeTimer);
    $('notice').textContent = text;
    $('notice').hidden = !text;
    if (text && !sticky) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000);
  }

  async function showMedia() {
    const { media } = timeline.state;
    const key = mediaKey(media);
    const haveFile = media?.type !== 'file' || localFile?.key === key;
    $('empty').hidden = Boolean(media);
    $('need-file').hidden = haveFile;
    if (!haveFile) {
      $('need-file-text').textContent = `Включён файл «${media.name}» (${megabytes(media.size)}). Откройте у себя такой же: видео никуда не загружается, синхронизируется только управление.`;
    }

    const wanted = haveFile ? key : '';
    if (wanted === loadedKey) return follower.apply();

    loadedKey = wanted;
    const token = ++loadToken;
    enhancer?.destroy();
    enhancer = null;
    $('enhance').hidden = true;
    follower.player?.destroy();
    follower.detach();
    $('player').replaceChildren();
    notice('');
    if (!wanted) return;

    // свой контейнер на каждую загрузку, чтобы отменённая не затёрла новую
    const box = document.createElement('div');
    $('player').append(box);
    const onError = (text) => { if (token === loadToken) notice(text, true); };
    try {
      let player;
      if (media.type === 'youtube') player = await createYoutube(box, media.id, timeline.position(), onError);
      else if (media.type === 'kinopoisk') {
        player = createKinopoisk(box, media, timeline.position(), { ext, onReady: () => follower.apply() });
        // у второго человека вкладка Кинопоиска сама переходит на тот же фильм или серию
        if (kpPageKey !== key) openKinopoisk(media.url, true);
      } else player = await createVideo(box, media.type === 'file' ? localFile.file : media.url, timeline.position(), onError);
      if (token !== loadToken) return player.destroy();
      follower.attach(player);
      if (player.element) attachEnhancer(player.element, box);
    } catch (error) {
      console.error(error);
      if (token !== loadToken) return;
      loadedKey = '';
      onError(media.type === 'youtube'
        ? 'YouTube не загрузился. Проверьте, открывается ли он у вас вообще, и включите видео ещё раз.'
        : 'Не получилось открыть видео.');
    }
  }

  // ----- Кинопоиск через расширение -----

  let kpPageKey = '';
  let kpOpenedAt = -Infinity;

  function openKinopoisk(url, onlyExisting) {
    if (!ext.ready) return;
    kpOpenedAt = performance.now();
    ext.send({ kind: 'open', url, onlyExisting });
  }

  ext.on((msg) => {
    if (msg.kind === 'page' && typeof msg.url === 'string') {
      const parsed = parseLink(msg.url);
      const media = parsed?.media.type === 'kinopoisk' ? parsed.media : null;
      const key = media ? mediaKey(media) : '';
      if (key === kpPageKey) return;
      kpPageKey = key;
      // переход сделали мы сами — это не выбор человека
      if (!media || performance.now() - kpOpenedAt < 4000) return;
      const current = timeline.state.media;
      if (key === mediaKey(current) || (current && current.type !== 'kinopoisk')) return;
      // человек сам открыл другой фильм или серию во вкладке Кинопоиска — переключаем обоих
      startMedia(media, 0);
    }
    if (msg.kind === 'say' && typeof msg.text === 'string') sayText(msg.text);
    if (msg.kind === 'blocked') notice('Нажмите ▶ во вкладке Кинопоиска: браузер не дал запустить видео сам.', true);
  });

  // сообщения и события второго человека дублируем поверх фильма на Кинопоиске
  function relay(name, text) {
    if (ext.ready && timeline.state.media?.type === 'kinopoisk') ext.send({ kind: name ? 'chat' : 'notice', name, text });
  }

  // улучшение картинки: у каждого своё, по сети не передаётся
  function attachEnhancer(video, box) {
    try {
      enhancer = createEnhancer(video, box, {
        onUnavailable() {
          $('enhance').hidden = true;
          notice('Для этой ссылки чёткость не включить: сайт с видео не разрешает обрабатывать кадры.');
        },
      });
    } catch (error) {
      console.warn('Улучшение картинки недоступно', error);
      enhancer = null;
    }
    if (!enhancer) return;
    enhancer.setMode(enhanceMode);
    $('enhance').hidden = false;
    $('enhance').textContent = MODES[enhanceMode].title;
  }

  $('enhance').addEventListener('click', () => {
    const order = Object.keys(MODES);
    enhanceMode = order[(order.indexOf(enhanceMode) + 1) % order.length];
    store.set('vd.enhance', enhanceMode);
    $('enhance').textContent = MODES[enhanceMode].title;
    enhancer?.setMode(enhanceMode);
  });

  function startMedia(media, pos = 0) {
    timeline.local({ media, playing: false, pos });
    sendState('media');
    addEvent(describe('media', 0, 'Вы'));
    showMedia();
  }

  const megabytes = (bytes) => bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' ГБ' : Math.round(bytes / 1e6) + ' МБ';

  function useFile(file) {
    const { media } = timeline.state;
    const missing = media?.type === 'file' && localFile?.key !== mediaKey(media);
    if (missing) {
      localFile = { key: mediaKey(media), file };
      showMedia();
      if (file.size !== media.size) {
        notice('Размер файла отличается: если это другая версия, сцены могут не совпадать.');
      }
    } else {
      const next = { type: 'file', name: file.name, size: file.size };
      localFile = { key: mediaKey(next), file };
      startMedia(next);
    }
  }

  $('source').addEventListener('submit', (event) => {
    event.preventDefault();
    const parsed = parseLink($('url').value);
    const error = $('source-error');
    error.hidden = Boolean(parsed);
    if (!parsed) {
      error.textContent = 'Эта ссылка не подходит. Можно вставить Кинопоиск, YouTube или прямую ссылку на файл mp4, webm, m3u8.';
      return;
    }
    $('url').value = '';
    $('url').blur();
    if (mediaKey(parsed.media) === loadedKey && !follower.player) loadedKey = '';
    startMedia(parsed.media, parsed.start);
  });
  $('url').addEventListener('input', () => { $('source-error').hidden = true; });

  for (const input of [$('file'), $('file-match')]) {
    input.addEventListener('change', () => {
      if (input.files[0]) useFile(input.files[0]);
      input.value = '';
    });
  }

  $('tap').addEventListener('click', () => {
    $('tap').hidden = true;
    follower.apply();
  });

  setInterval(() => follower.tick(), 400);

  // ----- чат -----

  const theater = $('theater');
  const chatOpen = () => !theater.classList.contains('no-chat');

  const chatVisible = () => chatOpen() && !$('pane-chat').hidden;

  function setChat(open) {
    theater.classList.toggle('no-chat', !open);
    $('chat-toggle').setAttribute('aria-pressed', String(open));
    if (open) {
      $('quick').hidden = true;
      $('toasts').replaceChildren();
    }
    markRead();
  }

  function markRead() {
    if (chatVisible()) {
      unread = 0;
      scrollDown();
    }
    showUnread();
  }

  function setTab(tab) {
    for (const key of ['chat', 'list']) {
      $('pane-' + key).hidden = key !== tab;
      $('tab-' + key).setAttribute('aria-selected', String(key === tab));
    }
    markRead();
  }
  $('tab-chat').addEventListener('click', () => setTab('chat'));
  $('tab-list').addEventListener('click', () => setTab('list'));

  function showUnread() {
    $('unread').hidden = !unread;
    $('unread').textContent = unread;
    $('fs-chat').textContent = unread ? `Чат (${unread})` : 'Чат';
  }

  const scrollDown = () => { $('messages').scrollTop = $('messages').scrollHeight; };

  function linkified(text) {
    return text.split(/(https?:\/\/\S+)/g).map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part);
      const a = document.createElement('a');
      a.href = part;
      a.textContent = part;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    });
  }

  function messageNode(message) {
    const li = document.createElement('li');
    const mine = message.from === me;
    li.className = mine ? 'msg mine' : 'msg';
    li.append(...linkified(message.text));
    const meta = document.createElement('small');
    const time = new Date(message.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    meta.textContent = mine ? time : `${message.name}, ${time}`;
    li.append(meta);
    return li;
  }

  function addEvent(text) {
    if (!text) return;
    const list = $('messages');
    // подряд идущие перемотки не копим
    const previous = list.lastElementChild;
    const li = previous?.dataset.event === text.split(' на ')[0] ? previous : document.createElement('li');
    li.className = 'event';
    li.dataset.event = text.split(' на ')[0];
    li.textContent = text;
    list.append(li);
    scrollDown();
  }

  function renderChat() {
    $('messages').replaceChildren(...messages.map(messageNode));
    scrollDown();
  }

  // добавляет только незнакомые сообщения, возвращает их
  function merge(incoming) {
    const known = new Set(messages.map((m) => m.id));
    // сообщения из сети проверяем: иначе битое сообщение сломало бы сортировку или вёрстку
    const fresh = incoming
      .filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string' && typeof m.name === 'string'
        && Number.isFinite(m.ts) && !known.has(m.id))
      .map((m) => ({ id: m.id, from: String(m.from ?? ''), name: m.name.slice(0, 24), text: m.text.slice(0, 1000), ts: m.ts }));
    if (!fresh.length) return fresh;
    const lastTs = messages.at(-1)?.ts ?? 0;
    messages = [...messages, ...fresh].sort((a, b) => a.ts - b.ts).slice(-HISTORY);
    store.set(chatKey, messages);
    if (fresh.length === 1 && fresh[0].ts >= lastTs) {
      $('messages').append(messageNode(fresh[0]));
      scrollDown();
    } else {
      renderChat();
    }
    return fresh;
  }

  function incomingChat(message) {
    if (!merge([message]).length) return;
    showTyping('');
    relay(message.name, message.text);
    if (chatVisible()) return;
    unread++;
    showUnread();
    if (chatOpen()) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const author = document.createElement('b');
    author.textContent = message.name;
    toast.append(author, message.text);
    $('toasts').append(toast);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => toast.remove(), 7000);
  }

  function say(input) {
    const text = input.value.trim();
    input.value = '';
    sayText(text);
  }

  function sayText(raw) {
    const text = raw.trim().slice(0, 1000);
    if (!text) return;
    const message = { id: randomId(8), from: me, name, text, ts: Date.now() };
    merge([message]);
    send({ type: 'chat', message });
  }

  $('send').addEventListener('submit', (event) => { event.preventDefault(); say($('text')); });
  $('quick').addEventListener('submit', (event) => {
    event.preventDefault();
    say($('quick-input'));
    $('quick').hidden = true;
  });
  $('chat-toggle').addEventListener('click', () => setChat(!chatOpen()));
  renderChat();

  // ----- «печатает» -----

  let typingTimer;
  let typedAt = -Infinity;
  function showTyping(who) {
    clearTimeout(typingTimer);
    $('typing').textContent = who ? `${who} печатает…` : '';
    if (who) typingTimer = setTimeout(() => showTyping(''), 3500);
  }
  for (const input of [$('text'), $('quick-input')]) {
    input.addEventListener('input', () => {
      if (!input.value || performance.now() - typedAt < 2000) return;
      typedAt = performance.now();
      send({ type: 'typing' });
    });
  }

  // ----- реакции и отсчёт -----

  let reactedAt = -Infinity;
  const stage = document.querySelector('.stage');

  const cat = createCat(stage, {
    onPet: () => send({ type: 'cat', act: 'pet' }),
    onHeart: () => fly($('sky'), 'heart', 1),
  });

  function showReaction(id, who, spot) {
    if (id === CAT) {
      return cat.show(spot);
    }
    if (id === HOOKAH) {
      showHookah(stage);
      return notice(who ? `${who} курит кальян` : 'Дым пошёл');
    }
    fly($('sky'), id);
    if (id !== HUG) return;
    notice(who ? `${who} обнимает вас` : 'Объятие отправлено');
    if (who && navigator.userActivation?.hasBeenActive) navigator.vibrate?.([80, 60, 160]);
  }
  for (const box of document.querySelectorAll('.reactions')) {
    for (const [id, title] of Object.entries(REACTIONS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-label', title);
      const face = document.createElement('img');
      face.src = picture(id);
      face.alt = '';
      face.className = id;
      button.append(face);
      button.addEventListener('click', () => {
        if (performance.now() - reactedAt < 300) return;
        reactedAt = performance.now();
        if (id === CAT) {
          const spot = randomSpot();
          showReaction(id, '', spot);
          return send({ type: 'cat', act: 'show', spot });
        }
        showReaction(id);
        send({ type: 'react', id });
      });
      box.append(button);
    }
  }
  // кальян и дым готовим заранее, когда страница уже свободна
  (window.requestIdleCallback ?? setTimeout)(() => prepareHookah(stage));

  $('countdown').addEventListener('click', () => {
    if (!follower.player) return notice('Сначала включите видео.');
    if (timeline.state.playing) {
      timeline.local({ playing: false });
      sendState('pause');
      follower.apply();
    }
    const { rev } = timeline.state;
    send({ type: 'countdown' });
    countdown($('count'), () => {
      if (timeline.state.rev !== rev) return; // пока считали, кто-то перемотал или сменил видео
      timeline.local({ playing: true });
      sendState('play');
      addEvent(describe('play', 0, 'Вы'));
      follower.apply();
    });
  });

  // ----- хотим посмотреть -----

  const listKey = 'vd.list.' + room;
  let wishes = store.get(listKey, []);

  function renderList() {
    const nodes = wishes.filter((item) => !item.deleted).map((item) => {
      const li = document.createElement('li');
      li.className = item.done ? 'wish done' : 'wish';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = Boolean(item.done);
      check.setAttribute('aria-label', 'Посмотрели: ' + item.text);
      check.addEventListener('change', () => updateList([edit(item, { done: check.checked })]));
      const text = document.createElement('span');
      text.textContent = item.text;
      li.append(check, text);
      const parsed = parseLink(item.text);
      if (parsed) {
        const play = document.createElement('button');
        play.type = 'button';
        play.textContent = 'Включить';
        play.addEventListener('click', () => startMedia(parsed.media, parsed.start));
        li.append(play);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Убрать: ' + item.text);
      remove.addEventListener('click', () => updateList([edit(item, { deleted: true })]));
      li.append(remove);
      return li;
    });
    $('wishes').replaceChildren(...nodes);
    $('pick').hidden = waiting(wishes).length < 2;
  }

  function applyList(items) {
    const next = mergeList(wishes, items);
    if (next === wishes) return;
    wishes = next;
    store.set(listKey, wishes);
    renderList();
  }

  function updateList(items) {
    applyList(items);
    send({ type: 'list', items });
  }

  $('add-wish').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('wish-text').value.trim();
    if (!text) return;
    $('wish-text').value = '';
    const time = Date.now();
    updateList([{ id: randomId(8), text, added: time, updated: time }]);
  });

  $('pick').addEventListener('click', () => {
    const options = waiting(wishes);
    if (!options.length) return;
    const choice = options[Math.floor(Math.random() * options.length)];
    const message = { id: randomId(8), from: me, name, text: `Жребий выбрал: ${choice.text}`, ts: Date.now() };
    merge([message]);
    send({ type: 'chat', message });
    setTab('chat');
  });
  renderList();

  // ----- полный экран -----

  const isFull = () => theater.classList.contains('full');

  function setFull(full) {
    if (full === isFull()) return;
    theater.classList.toggle('full', full);
    $('quick').hidden = true;
    setChat(!full);
  }

  $('fs').addEventListener('click', () => {
    setFull(true);
    // на iPhone настоящего полного экрана для блока нет, остаётся развёрнутый вид
    theater.requestFullscreen?.().catch(() => {});
  });
  $('fs-exit').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    setFull(false);
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setFull(false); });
  $('fs-chat').addEventListener('click', () => {
    if (!chatOpen()) setTab('chat');
    setChat(!chatOpen());
  });

  document.addEventListener('keydown', (event) => {
    if (!isFull()) return;
    if (event.key === 'Escape') {
      if (!$('quick').hidden) $('quick').hidden = true;
      else if (!document.fullscreenElement) setFull(false);
    } else if (event.key === 'Enter' && !event.isComposing && !event.target.closest('input, button')) {
      event.preventDefault();
      if (chatOpen()) { setTab('chat'); $('text').focus(); }
      else { $('quick').hidden = false; $('quick-input').focus(); }
    }
  });

  $('invite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('invite').textContent = 'Ссылка скопирована';
      setTimeout(() => { $('invite').textContent = 'Пригласить'; }, 2000);
    } catch {
      prompt('Отправьте эту ссылку:', location.href);
    }
  });

  // ----- связь -----

  function showStatus() {
    if (!online) return setStatus('Нет связи, переподключаемся…', 'bad');
    if (!peers.size) return setStatus('Вы пока одни. Отправьте приглашение.');
    const { media, playing } = timeline.state;
    const lines = [...peers.values()].map((peer) => {
      if (media && peer.key !== mediaKey(media)) return `${peer.name}: видео ещё не открыто`;
      if (media && playing && peer.player === 'buffering') return `${peer.name}: загружается`;
      if (media && follower.player && peer.pos != null) {
        // позиция партнёра на момент последнего сигнала против нашей шкалы тогда же
        const drift = Math.abs(peer.drift);
        if (drift > DRIFT_SHOWN) return `${peer.name}: расхождение ${Math.round(drift)} с`;
      }
      return `${peer.name} здесь`;
    });
    setStatus(lines.join(' · '), 'ok');
  }
  const DRIFT_SHOWN = 3;

  function beat() {
    const echo = {};
    for (const [id, peer] of peers) echo[id] = [peer.sentAt, performance.now() - peer.gotAt];
    const player = follower.player;
    send({
      type: 'beat',
      t: performance.now(),
      echo,
      key: player ? loadedKey : '',
      player: player?.state() ?? '',
      pos: player ? player.time() : null,
    });
  }

  function hello() {
    send({ type: 'hello' });
    beat();
  }

  function cleanState(state) {
    if (!state || !Number.isFinite(state.rev) || !Number.isFinite(state.pos)) return null;
    const media = cleanMedia(state.media);
    if (media === undefined) return null;
    return { rev: state.rev, by: String(state.by ?? ''), media, playing: Boolean(state.playing), pos: Math.max(0, state.pos) };
  }

  function onMessage(message) {
    const { from, type } = message;
    if (!from || from === me) return;

    if (type === 'bye') {
      if (peers.delete(from)) addEvent(`${message.name} выходит`);
      return showStatus();
    }

    let peer = peers.get(from);
    const isNew = !peer;
    if (isNew) {
      peer = { name: message.name, seen: 0, sentAt: 0, gotAt: 0 };
      peers.set(from, peer);
      addEvent(`${message.name} здесь`);
    }
    peer.name = message.name;
    peer.seen = performance.now();

    if (type === 'hello' || isNew) {
      // делимся тем, что знаем: кто свежее, тот и победит
      if (timeline.state.rev) send({ type: 'state', state: timeline.snapshot() });
      if (messages.length) send({ type: 'history', messages: messages.slice(-60) });
      if (wishes.length) send({ type: 'list', items: wishes });
      beat();
    }
    if (type === 'beat') {
      peer.sentAt = message.t;
      peer.gotAt = performance.now();
      const mine = message.echo?.[me];
      if (mine?.[0]) {
        const rtt = performance.now() - mine[0] - mine[1];
        if (rtt >= 0 && rtt < 10000) peer.rtt = peer.rtt == null ? rtt : peer.rtt * 0.7 + rtt * 0.3;
      }
      peer.key = message.key;
      peer.player = message.player;
      peer.pos = message.pos;
      peer.drift = message.pos == null ? 0
        : message.pos + (timeline.state.playing ? latencyOf(from) : 0) - timeline.position();
    }
    const state = type === 'state' ? cleanState(message.state) : null;
    if (state && timeline.remote(state, latencyOf(from))) {
      addEvent(describe(message.action, message.state.pos, message.name));
      relay('', describe(message.action, message.state.pos, message.name));
      remember();
      showMedia();
    }
    if (type === 'chat' && message.message) incomingChat(message.message);
    if (type === 'history' && Array.isArray(message.messages)) merge(message.messages);
    if (type === 'list' && Array.isArray(message.items)) applyList(message.items);
    if (type === 'typing') showTyping(message.name);
    if (type === 'react' && Object.hasOwn(REACTIONS, message.id)) {
      showReaction(message.id, message.name);
      relay('', `${message.name}: ${REACTIONS[message.id].toLowerCase()}`);
    }
    if (type === 'cat') {
      if (message.act === 'pet') cat.pet();
      else if (message.act === 'hide') cat.hide();
      else {
        const { x, y, tilt } = message.spot ?? {};
        const ok = [x, y, tilt].every(Number.isFinite);
        showReaction(CAT, message.name, ok ? { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), tilt } : randomSpot());
        notice(`${message.name} зовёт кота`);
      }
    }
    if (type === 'countdown') countdown($('count'));
    showStatus();
  }

  channel = await openChannel(room, {
    onMessage,
    onConnection(count, joined) {
      online = count;
      if (joined) hello();
      showStatus();
    },
  });
  if (online) hello();

  setInterval(() => {
    for (const [id, peer] of peers) {
      if (performance.now() - peer.seen > PEER_TIMEOUT_MS) {
        peers.delete(id);
        addEvent(`${peer.name}: связь пропала`);
      }
    }
    beat();
    remember();
    showStatus();
  }, BEAT_MS);

  addEventListener('pagehide', () => send({ type: 'bye' }));

  // Если в комнате никого, возвращаем то, что смотрели в прошлый раз.
  setTimeout(() => {
    const saved = store.get(savedKey, null);
    if (!timeline.state.rev && !peers.size && online && saved?.media) {
      timeline.local({ media: saved.media, playing: false, pos: saved.pos });
      showMedia();
    }
  }, 4000);
}
