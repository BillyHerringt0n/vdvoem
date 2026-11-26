// Общая шкала времени и подгонка под неё локального плеера.
// Состояние комнаты: что включено, играет ли, с какой секунды.
// Новее то состояние, у которого больше rev (при равенстве решает id автора).

const SETTLE_MS = 1500;   // после своей команды не принимаем изменения плеера за действия человека
const JUMP_S = 1.5;       // скачок времени, который считаем перемоткой
const DRIFT_S = 2.5;      // расхождение, после которого подтягиваемся
const CORRECT_EVERY_MS = 8000;
const BLOCKED_AFTER_MS = 3000;

export function createTimeline(me, now = () => performance.now()) {
  let state = { rev: 0, by: '', media: null, playing: false, pos: 0, at: now() };

  const position = () => state.pos + (state.playing ? (now() - state.at) / 1000 : 0);

  return {
    get state() { return state; },
    position,
    snapshot: () => ({ rev: state.rev, by: state.by, media: state.media, playing: state.playing, pos: position() }),
    local(patch) {
      state = { ...state, pos: position(), ...patch, rev: state.rev + 1, by: me, at: now() };
    },
    remote(next, latency) {
      const newer = next.rev > state.rev || (next.rev === state.rev && next.by > state.by);
      if (!newer) return false;
      const { rev, by, media, playing, pos } = next;
      state = { rev, by, media, playing, pos: pos + (playing ? latency : 0), at: now() };
      return true;
    },
  };
}

export function createFollower(timeline, { publish, onBlocked, now = () => performance.now() }) {
  let player = null;
  let quietUntil = 0;
  let confirmed = false;   // плеер уже дошёл до нужного play/pause
  let askedAt = 0;
  let correctedAt = -Infinity;
  let mismatches = 0;
  let last = { t: 0, at: 0 };

  function apply() {
    if (!player) return;
    const { playing } = timeline.state;
    const target = timeline.position();
    if (Math.abs(player.time() - target) > (playing ? 1 : 0.4)) player.seek(target);
    const current = player.state();
    if (playing && current !== 'playing') player.play();
    if (!playing && (current === 'playing' || current === 'buffering')) player.pause();
    confirmed = false;
    mismatches = 0;
    askedAt = now();
    quietUntil = askedAt + SETTLE_MS;
    last = { t: target, at: askedAt };
    onBlocked(false);
  }

  function tick() {
    if (!player) return;
    const time = now();
    const current = player.state();
    if (current === 'buffering' || current === 'ended') return;

    const t = player.time();
    const { playing } = timeline.state;
    const isPlaying = current === 'playing';
    const moved = t - last.t;
    const elapsed = (time - last.at) / 1000;
    last = { t, at: time };

    if (isPlaying === playing && !confirmed) {
      confirmed = true;
      onBlocked(false);
      if (Math.abs(t - timeline.position()) > 1) {
        player.seek(timeline.position());
        quietUntil = time + SETTLE_MS;
        return;
      }
    }
    if (time < quietUntil) return;

    if (!confirmed) {
      // Команду плеер так и не выполнил: чаще всего браузер запретил автозапуск.
      if (time - askedAt > BLOCKED_AFTER_MS) {
        if (playing) onBlocked(true);
        else player.pause();
      }
      return;
    }

    const jumped = (moved < -JUMP_S || moved > elapsed + JUMP_S) && Math.abs(t - timeline.position()) > JUMP_S;
    if (isPlaying !== playing) {
      // два тика подряд, чтобы не реагировать на мигание плеера
      if (++mismatches >= 2) {
        mismatches = 0;
        publish({ playing: isPlaying, pos: t }, isPlaying ? 'play' : 'pause');
      }
      return;
    }
    mismatches = 0;
    if (jumped) {
      publish({ playing, pos: t }, 'seek');
    } else if (playing && Math.abs(t - timeline.position()) > DRIFT_S && time - correctedAt > CORRECT_EVERY_MS) {
      correctedAt = time;
      quietUntil = time + SETTLE_MS;
      player.seek(timeline.position());
    }
  }

  return {
    attach(next) { player = next; apply(); },
    detach() { player = null; onBlocked(false); },
    apply,
    tick,
    get player() { return player; },
  };
}
