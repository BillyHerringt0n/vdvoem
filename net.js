// Связь между двумя браузерами через публичные MQTT-брокеры.
// Своего сервера нет. Всё содержимое шифруется ключом из ссылки-приглашения,
// брокер видит только случайный адрес комнаты и шифртекст.
// Подключаемся сразу к двум брокерам: если один лежит, работает второй.

import { loadScript } from './load.js';

const MQTT = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js';
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digest = (text) => crypto.subtle.digest('SHA-256', encoder.encode(text));
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomId(bytes = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function openChannel(secret, { onMessage, onConnection }) {
  await loadScript(MQTT);
  const topic = 'vdvoem/' + hex(await digest('topic:' + secret)).slice(0, 32);
  const key = await crypto.subtle.importKey('raw', await digest('key:' + secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const seen = new Set();
  let online = 0;

  const clients = BROKERS.map((address) => {
    const client = mqtt.connect(address, {
      clientId: 'vd_' + randomId(8),
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      queueQoSZero: false,
    });
    let up = false;
    const setUp = (value) => {
      if (value === up) return;
      up = value;
      online += value ? 1 : -1;
      onConnection(online, value);
    };
    client.on('connect', () => {
      client.subscribe(topic, { qos: 1 }, (error) => { if (!error) setUp(true); });
    });
    client.on('close', () => setUp(false));
    client.on('error', () => {});
    client.on('message', async (_, payload) => {
      let message;
      try {
        const packet = Uint8Array.from(atob(payload.toString()), (c) => c.charCodeAt(0));
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: packet.subarray(0, 12) }, key, packet.subarray(12));
        message = JSON.parse(decoder.decode(plain));
      } catch { return; } // чужое или повреждённое сообщение
      if (seen.has(message.mid)) return;
      seen.add(message.mid);
      if (seen.size > 2000) seen.delete(seen.values().next().value);
      onMessage(message);
    });
    return client;
  });

  return {
    async send(message) {
      const mid = randomId(8);
      seen.add(mid); // своё эхо не обрабатываем
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify({ ...message, mid })));
      const packet = new Uint8Array(12 + body.byteLength);
      packet.set(iv);
      packet.set(new Uint8Array(body), 12);
      // строкой, потому что бинарные данные mqtt.js в браузере принимает только в своём Buffer
      let binary = '';
      for (const byte of packet) binary += String.fromCharCode(byte);
      const text = btoa(binary);
      for (const client of clients) {
        if (client.connected) client.publish(topic, text, { qos: 0 });
      }
    },
  };
}
