// Реакции, летящие поверх видео, кальян и отсчёт перед стартом.

export const HUG = 'hug';
export const HOOKAH = 'hookah';
export const CAT = 'cat';
export const REACTIONS = {
  heart: 'Сердечко',
  joy: 'Смешно',
  wow: 'Ого',
  aww: 'Мило',
  popcorn: 'Попкорн',
  hug: 'Обнять',
  hookah: 'Кальян',
  cat: 'Погладить кота',
};
export const picture = (id) => (id === CAT ? 'assets/cat-face.webp' : `assets/${id}.png`);

export function fly(sky, id, count) {
  // объятие — это сразу много сердечек
  const items = id === HUG ? [HUG, ...Array(12).fill('heart')] : Array(count ?? 1).fill(id);
  for (const [i, item] of items.entries()) {
    if (sky.children.length > 40) break;
    const node = document.createElement('img');
    node.className = 'fly';
    node.src = picture(item);
    node.alt = '';
    node.style.left = `${8 + Math.random() * 80}%`;
    node.style.setProperty('--sway', `${Math.round(Math.random() * 80 - 40)}px`);
    node.style.animationDelay = `${i * 90}ms`;
    node.addEventListener('animationend', () => node.remove());
    sky.append(node);
  }
}

// Кальян: фото выезжает сбоку с пружинкой, угли разгораются на затяжках, в колбе булькает,
// а из чаши поднимается дым. Дым — живая симуляция на видеокарте (smoke.js), не ролик:
// тонкая струйка всё время, на затяжках — клубы, которые закручиваются и тают.

import { createSmoke } from './smoke.js';

const SHOW_MS = 7500;    // сколько кальян на экране
const SMOKE_MS = 9500;   // дым ещё пару секунд тает после ухода кальяна
const PUFFS = [900, 3300]; // начала затяжек
const PUFF_MS = 1100;
let hookah;

export function prepareHookah(stage) {
  if (hookah) return hookah;
  const scene = document.createElement('div');
  scene.className = 'hookah-scene';
  scene.hidden = true;
  scene.innerHTML = `
    <div class="hookah-rig">
      <img class="hookah-photo" src="assets/hookah.png" alt="">
      <span class="coal"></span>
      <span class="bubbles">${'<i></i>'.repeat(7)}</span>
    </div>`;
  stage.append(scene);
  let smoke = null;
  try { smoke = createSmoke(stage); } catch (error) { console.warn('Дым недоступен', error); }
  hookah = {
    scene, smoke,
    rig: scene.querySelector('.hookah-rig'),
    photo: scene.querySelector('.hookah-photo'),
    coal: scene.querySelector('.coal'),
    bubbles: scene.querySelector('.bubbles'),
    busy: false,
  };
  return hookah;
}

// ключевые кадры «вспышки» на каждой затяжке для углей и пузырьков
function onPuffs(low, high) {
  const frames = [{ opacity: 0 }, { opacity: low, offset: 0.06 }];
  for (const start of PUFFS) {
    const from = start / SHOW_MS;
    const to = (start + PUFF_MS) / SHOW_MS;
    frames.push({ opacity: low, offset: from - 0.01 }, { opacity: high, offset: from + 0.01 },
      { opacity: high, offset: to - 0.02 }, { opacity: low, offset: to + 0.02 });
  }
  frames.push({ opacity: low, offset: 0.87 }, { opacity: 0 });
  return frames;
}

export function showHookah(stage) {
  const h = prepareHookah(stage);
  if (h.busy) return;
  h.busy = true;
  h.scene.hidden = false;
  const running = [];

  running.push(h.rig.animate([
    { transform: 'translateX(-140%) rotate(-14deg)', easing: 'cubic-bezier(.2,.9,.25,1)' },
    { transform: 'translateX(5%) rotate(3deg)', offset: 0.05, easing: 'ease-in-out' },
    { transform: 'translateX(-1%) rotate(-1deg)', offset: 0.065, easing: 'ease-in-out' },
    { transform: 'none', offset: 0.08 },
    { transform: 'none', offset: 0.9, easing: 'cubic-bezier(.55,0,.8,.35)' },
    { transform: 'translateX(-140%) rotate(-10deg)' },
  ], { duration: SHOW_MS, fill: 'forwards' }));

  // лёгкое покачивание, будто кальян стоит на столе рядом
  running.push(h.photo.animate([
    { transform: 'rotate(-1.2deg)' }, { transform: 'rotate(1.2deg)' },
  ], { duration: 2300, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }));

  running.push(h.coal.animate(onPuffs(0.4, 1), { duration: SHOW_MS, fill: 'forwards' }));
  running.push(h.coal.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1.08)' }],
    { duration: 260, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }));
  running.push(h.bubbles.animate(onPuffs(0, 1), { duration: SHOW_MS, fill: 'forwards' }));
  [...h.bubbles.children].forEach((bubble, i) => {
    bubble.style.left = `${15 + ((i * 37) % 70)}%`;
    running.push(bubble.animate([
      { transform: 'translateY(0) scale(.5)', opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: 'translateY(-260%) scale(1)', opacity: 0 },
    ], { duration: 520 + (i % 3) * 90, delay: i * 70, iterations: Infinity, easing: 'ease-in' }));
  });

  // точка на фото кальяна в долях экрана (кальян в это время может ехать)
  const at = (fx, fy) => {
    const b = stage.getBoundingClientRect();
    const r = h.rig.getBoundingClientRect();
    return [(r.left + r.width * fx - b.left) / b.width, (r.top + r.height * fy - b.top) / b.height];
  };

  // псевдошум: у каждого показа свой рисунок клубов
  const seed = Math.random() * 1000;
  const wobble = (t, k) => Math.sin(t / 173 + seed * k) + 0.5 * Math.sin(t / 59 + seed * 2 * k);

  h.smoke?.play({
    duration: SMOKE_MS,
    fadeFrom: SMOKE_MS - 2200,
    lift: 70, wind: [55, 0], curl: 12, velocityFade: 1.0, fade: 0.5, density: 2.2, shade: 0.35,
    emit(t, splat, dt) {
      const k = Math.min(2, dt * 60); // одинаково при любой частоте кадров
      if (t > 600 && t < SHOW_MS - 1300) {
        // тонкая струйка из чаши, слегка колышется
        const [x, y] = at(0.55, 0.02);
        splat(x, y, wobble(t, 1) * 45 * k, -95 * k, 0.035 * k, 0.025);
      }
      for (const [i, start] of PUFFS.entries()) {
        const p = (t - start) / PUFF_MS;
        if (p < 0 || p > 1) continue;
        const e = Math.sin(Math.PI * p) * k;
        const [x, y] = at(0.58, 0.0);
        const side = i ? 1.4 : 1;
        // клуб: основной поток вверх-вправо плюс турбулентные завихрения по краям
        splat(x, y, (120 + 50 * wobble(t, 2)) * side * e, -(170 + 40 * wobble(t, 3)) * e, 0.26 * e, 0.28);
        splat(x + 0.012 * wobble(t, 4), y - 0.01, 90 * wobble(t, 5) * e, -60 * e, 0.08 * e, 0.12);
      }
    },
  });

  setTimeout(() => {
    for (const animation of running) animation.cancel();
    h.scene.hidden = true;
  }, SHOW_MS);
  setTimeout(() => { h.busy = false; }, h.smoke ? SMOKE_MS : SHOW_MS);
}

let timer;
export function countdown(box, done) {
  clearTimeout(timer);
  let left = 3;
  const step = () => {
    if (!left) {
      box.hidden = true;
      return done?.();
    }
    const number = document.createElement('span');
    number.textContent = left--;
    box.replaceChildren(number);
    box.hidden = false;
    timer = setTimeout(step, 1000);
  };
  step();
}
