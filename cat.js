// Кот, которого можно гладить вдвоём.
// Каждое нажатие на кнопку сажает кота в новое место экрана (одинаковое у обоих).
// Нажатие на кота: сверху опускается ладонь, гладит, кота чуть сплющивает.
// Пока гладят часто, рука не уходит, а гладит дальше.

const IDLE_HIDE_MS = 4500;   // если кота не гладят
const AFTER_PET_MS = 700;    // после того как рука ушла
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// место выбирает тот, кто нажал, и отправляет второму долями от размера экрана
export const randomSpot = () => ({
  x: Math.random(),
  y: Math.random(),
  tilt: Math.round(Math.random() * 16 - 8),
});

export function createCat(stage, { onPet, onHeart }) {
  const zone = document.createElement('div');
  zone.className = 'cat-zone';
  zone.hidden = true;
  zone.innerHTML = `
    <button type="button" class="kitty" aria-label="Погладить кота">
      <span class="cat-head"></span>
    </button>
    <span class="hand"><span class="palm"></span></span>
    <span class="purr" aria-hidden="true">мрр</span>`;
  stage.append(zone);

  const head = zone.querySelector('.cat-head');
  const hand = zone.querySelector('.hand');
  const purr = zone.querySelector('.purr');
  let entrance;
  let breathing;
  let hideTimer;
  let queue = 0;
  let running = false;
  let visible = false;
  let spot = { x: 0.7, y: 1, tilt: 0 };

  // рука как в ролике: заходит сбоку сверху и кончиками пальцев гладит макушку
  const UP = 'translate(-120%, -110%) rotate(-14deg)'; // за краем, рука не просвечивает
  const REST = 'none';

  function place() {
    const box = stage.getBoundingClientRect();
    // размер от экрана: на телефоне кот с рукой должен помещаться по высоте
    const width = Math.round(Math.max(80, Math.min(300, box.width * 0.26, box.height * 0.5)));
    const height = width * (460 / 500);
    zone.style.width = `${width}px`;
    const above = height * 0.7; // место сверху для руки
    const side = width * 0.32; // место слева для руки
    const left = side + spot.x * Math.max(0, box.width - width - side);
    const top = above + spot.y * Math.max(0, box.height - height - above);
    zone.style.left = `${left}px`;
    zone.style.top = `${top}px`;
    zone.style.rotate = `${spot.tilt}deg`;
  }

  function popIn() {
    entrance?.cancel();
    entrance = zone.animate([
      { transform: 'scale(0) rotate(-25deg)', opacity: 0 },
      { transform: 'scale(1.12) rotate(4deg)', opacity: 1, offset: 0.6 },
      { transform: 'scale(.96) rotate(-1deg)', offset: 0.82 },
      { transform: 'none', opacity: 1 },
    ], { duration: 560, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  }

  async function show(next) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, IDLE_HIDE_MS);
    const moving = visible && next;
    if (next) spot = next;
    if (visible && !moving) return;
    if (moving) {
      // уже сидит: исчезает и появляется в новом месте
      entrance?.cancel();
      entrance = zone.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0) rotate(20deg)', opacity: 0 }],
        { duration: 220, easing: 'ease-in', fill: 'forwards' });
      await entrance.finished.catch(() => {});
    }
    visible = true;
    zone.hidden = false;
    place();
    popIn();
    if (!breathing) {
      breathing = head.animate([
        { transform: 'scale(1, 1) rotate(-1deg)' },
        { transform: 'scale(1.012, 1.025) rotate(1deg)' },
      ], { duration: 1800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    }
  }

  function hide() {
    if (!visible) return;
    visible = false;
    clearTimeout(hideTimer);
    entrance?.cancel();
    entrance = zone.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'scale(1.08)', opacity: 1, offset: 0.3 },
      { transform: 'scale(0) rotate(20deg)', opacity: 0 },
    ], { duration: 380, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
    entrance.finished.then(() => {
      if (visible) return;
      breathing?.cancel();
      breathing = null;
      zone.hidden = true;
    }, () => {});
  }

  async function stroke(first) {
    const press = 430;
    hand.animate([
      { transform: REST },
      { transform: 'translate(-5%, 6%) rotate(3deg)', offset: 0.45 },
      { transform: 'translate(4%, -3%) rotate(-2deg)', offset: 0.75 },
      { transform: REST },
    ], { duration: press, easing: 'ease-in-out' });
    head.animate([
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.09, 0.82)', offset: 0.45 },
      { transform: 'scale(0.97, 1.04)', offset: 0.75 },
      { transform: 'scale(1, 1)' },
    ], { duration: press, easing: 'ease-in-out', composite: 'add' });
    if (first) {
      purr.animate([
        { opacity: 0, transform: 'translate(0, 10px) scale(.6)' },
        { opacity: 1, transform: 'translate(0, -6px) scale(1)', offset: 0.2 },
        { opacity: 1, transform: 'translate(6px, -14px) scale(1)', offset: 0.8 },
        { opacity: 0, transform: 'translate(10px, -24px) scale(.9)' },
      ], { duration: 1600, easing: 'ease-out' });
    }
    onHeart?.(zone);
    await sleep(press);
  }

  async function run() {
    running = true;
    hand.hidden = false;
    await hand.animate([{ transform: UP }, { transform: REST }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }).finished;
    let first = true;
    do {
      while (queue > 0) {
        queue--;
        await stroke(first);
        first = false;
      }
      await sleep(450);
    } while (queue > 0);
    await hand.animate([{ transform: REST }, { transform: UP }],
      { duration: 380, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' }).finished;
    running = false;
    // погладили, пока рука уходила, — сразу возвращаемся, а не прячем кота
    if (queue > 0) return run();
    hand.hidden = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, AFTER_PET_MS);
  }

  function pet() {
    show();
    clearTimeout(hideTimer); // спрячется сам, когда рука уйдёт
    queue = Math.min(queue + 1, 4);
    if (!running) run();
  }

  hand.hidden = true;
  zone.querySelector('.kitty').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pet();
    onPet();
  });
  addEventListener('resize', () => { if (visible) place(); });

  return { show, hide, pet, get visible() { return visible; } };
}
