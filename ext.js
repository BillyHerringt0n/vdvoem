// Связь страницы с расширением «Вдвоём — Кинопоиск» (через extension/bridge.js).

const listeners = new Set();
let ready = false;

addEventListener('message', (event) => {
  if (event.source !== window || event.data?.vdvoem !== 'from-ext') return;
  const msg = event.data.msg;
  if (!msg || typeof msg.kind !== 'string') return;
  if (msg.kind === 'ready') ready = true;
  for (const listener of listeners) listener(msg);
});

export const ext = {
  get ready() { return ready; },
  send(msg) { postMessage({ vdvoem: 'to-ext', msg }, location.origin); },
  on(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

ext.send({ kind: 'ping' });
