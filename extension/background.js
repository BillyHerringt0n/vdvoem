// Пересылает сообщения между вкладкой с комнатой «Вдвоём» и вкладкой Кинопоиска.
// Сеть, шифрование и синхронизация остаются на сайте, расширение только «руки» в плеере.

let site = null;               // id вкладки с комнатой
const players = new Map();     // id вкладки Кинопоиска -> id фрейма, где видео

const quiet = (promise) => promise?.catch?.(() => {});

chrome.runtime.onMessage.addListener((message, sender) => {
  const tab = sender.tab?.id;
  if (tab == null) return;

  if (message.from === 'site') {
    site = tab;
    if (message.kind === 'open') open(message.url, message.onlyExisting);
    else if (message.kind === 'command' || message.kind === 'chat' || message.kind === 'notice') {
      for (const [id, frameId] of players) quiet(chrome.tabs.sendMessage(id, message, { frameId }));
    }
    return;
  }

  if (message.from === 'kp') {
    if (message.kind === 'state') players.set(tab, sender.frameId);
    if (site != null) quiet(chrome.tabs.sendMessage(site, message));
  }
});

chrome.tabs.onRemoved.addListener((id) => {
  players.delete(id);
  if (id === site) site = null;
});

async function open(url, onlyExisting) {
  if (!/^https:\/\/(hd\.|www\.)?kinopoisk\.ru\//.test(url)) return;
  const [id] = players.keys();
  if (id != null) {
    players.delete(id); // после перехода плеер отметится заново
    await quiet(chrome.tabs.update(id, { url }));
  } else if (!onlyExisting) {
    await quiet(chrome.tabs.create({ url }));
  }
}
