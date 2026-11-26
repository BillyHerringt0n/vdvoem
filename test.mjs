// node test.mjs
import assert from 'node:assert/strict';
import { parseLink, clock } from './links.js';
import { createTimeline, createFollower } from './sync.js';
import { mergeList, edit, waiting } from './list.js';

const id = 'dQw4w9WgXcQ';
for (const link of [
  `https://www.youtube.com/watch?v=${id}`,
  `youtu.be/${id}?si=abc`,
  `https://youtube.com/shorts/${id}`,
  `https://m.youtube.com/live/${id}`,
]) assert.equal(parseLink(link)?.media.id, id, link);
assert.equal(parseLink(`https://youtu.be/${id}?t=1m30s`).start, 90);
assert.equal(parseLink('https://example.com/a/film.mp4?x=1').media.type, 'video');
for (const bad of ['', 'привет', 'javascript:alert(1)', 'https://example.com/page', 'https://youtube.com/watch?v=short']) {
  assert.equal(parseLink(bad), null, bad);
}
assert.equal(clock(3725), '1:02:05');

// Кинопоиск: служебные параметры отбрасываются, сезон и серия остаются
assert.equal(parseLink('https://www.kinopoisk.ru/series/464963/?utm_source=x').media.url, 'https://www.kinopoisk.ru/series/464963/');
assert.equal(parseLink('hd.kinopoisk.ru/film/4a9f?season=2&episode=5&from=main').media.url, 'https://hd.kinopoisk.ru/film/4a9f?episode=5&season=2');
assert.equal(parseLink('https://www.kinopoisk.ru/'), null);
assert.equal(parseLink('https://qqpoisk.ru/film/301/'), null);

// шкала: старое состояние не перетирает новое
let time = 0;
const now = () => time;
const timeline = createTimeline('a', now);
assert.ok(timeline.remote({ rev: 3, by: 'b', media: null, playing: true, pos: 10 }, 0.2));
assert.ok(!timeline.remote({ rev: 2, by: 'b', media: null, playing: false, pos: 0 }, 0));
time = 5000;
assert.ok(Math.abs(timeline.position() - 15.2) < 1e-9);

// фейковый плеер
function fake() {
  const p = {
    t: 0, s: 'paused', blocked: false,
    time: () => p.t, state: () => p.s,
    play() { if (!p.blocked) p.s = 'playing'; },
    pause() { p.s = 'paused'; },
    seek(t) { p.t = t; },
  };
  return p;
}
function setup(patch, blocked = false) {
  time = 0;
  const line = createTimeline('a', now);
  line.local({ pos: 0, playing: false, ...patch });
  const sent = [];
  let isBlocked = false;
  const follower = createFollower(line, {
    now,
    publish: (p, action) => { sent.push(action); line.local(p); },
    onBlocked: (v) => { isBlocked = v; },
  });
  const player = fake();
  player.blocked = blocked;
  follower.attach(player);
  const run = (ms) => {
    for (let i = 0; i < ms / 400; i++) {
      time += 400;
      if (player.s === 'playing') player.t += 0.4;
      follower.tick();
    }
  };
  return { line, player, follower, sent, run, blocked: () => isBlocked };
}

// своё применение команды не уходит в сеть эхом
let s = setup({ playing: true, pos: 30 });
s.run(6000);
assert.deepEqual(s.sent, []);

// пауза и перемотка человеком уходят
s.player.pause(); s.run(2000);
assert.deepEqual(s.sent, ['pause']);
s.player.seek(200); s.run(2000);
assert.deepEqual(s.sent, ['pause', 'seek']);
s.player.play(); s.run(2000);
assert.deepEqual(s.sent, ['pause', 'seek', 'play']);

// долгая загрузка не считается перемоткой, после неё догоняем общую шкалу
s = setup({ playing: true });
s.run(3000);
s.player.s = 'buffering'; s.run(6000);
s.player.s = 'playing'; s.run(1000);
assert.deepEqual(s.sent, []);
assert.ok(Math.abs(s.player.t - s.line.position()) < 1.5);

// автозапуск запрещён: просим нажать, а не ставим паузу партнёру
s = setup({ playing: true }, true);
s.run(6000);
assert.ok(s.blocked());
assert.deepEqual(s.sent, []);
s.player.blocked = false; s.follower.apply(); s.run(3000);
assert.ok(!s.blocked());
assert.equal(s.player.s, 'playing');

// список: поздняя правка побеждает, удалённое не воскресает
const film = { id: '1', text: 'Фильм', added: 1, updated: 1 };
const removed = edit(film, { deleted: true });
let list = mergeList([], [film]);
list = mergeList(list, [removed]);
assert.equal(mergeList(list, [film]), list);
assert.equal(waiting(list).length, 0);
assert.equal(mergeList(list, [null, { id: 2 }]), list);

console.log('ok');
