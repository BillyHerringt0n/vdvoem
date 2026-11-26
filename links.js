// Разбор вставленной ссылки. Возвращает { media, start } или null.

const YT_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be']);

function seconds(value) {
  if (!value) return 0;
  if (/^\d+s?$/.test(value)) return parseInt(value, 10);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

export function parseLink(input) {
  let text = String(input).trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = 'https://' + text;

  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.replace(/^www\./, '');
  if (YT_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    let id = null;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const start = seconds(url.searchParams.get('t') || url.searchParams.get('start'));
    return { media: { type: 'youtube', id }, start };
  }

  if (/\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)$/i.test(url.pathname)) {
    return { media: { type: 'video', url: url.href }, start: 0 };
  }

  // Кинопоиск: страница фильма или сериала, в том числе плеер hd.kinopoisk.ru с сезоном и серией
  if ((url.hostname === 'hd.kinopoisk.ru' || host === 'kinopoisk.ru') && /^\/(film|series)\/[\w-]+/.test(url.pathname)) {
    const clean = new URL(url.origin.replace('http:', 'https:') + url.pathname.replace(/\/+$/, '/'));
    // из параметров оставляем только то, что выбирает сезон и серию
    for (const [key, value] of [...url.searchParams].sort()) {
      if (/season|episode|serie|^ep$/i.test(key)) clean.searchParams.set(key, value);
    }
    return { media: { type: 'kinopoisk', url: clean.href }, start: 0 };
  }
  return null;
}

// Проверяет описание видео, пришедшее по сети: только известные типы и безопасные ссылки.
export function cleanMedia(media) {
  if (media === null) return null;
  if (!media || typeof media !== 'object') return undefined;
  if (media.type === 'youtube' && /^[\w-]{11}$/.test(media.id)) return { type: 'youtube', id: media.id };
  if (media.type === 'video' && typeof media.url === 'string') {
    const parsed = parseLink(media.url);
    return parsed?.media.type === 'video' ? parsed.media : undefined;
  }
  if (media.type === 'kinopoisk' && typeof media.url === 'string') {
    const parsed = parseLink(media.url);
    return parsed?.media.type === 'kinopoisk' ? parsed.media : undefined;
  }
  if (media.type === 'file' && typeof media.name === 'string' && Number.isFinite(media.size)) {
    return { type: 'file', name: media.name.slice(0, 200), size: media.size };
  }
  return undefined;
}

export function mediaKey(media) {
  if (!media) return '';
  if (media.type === 'youtube') return 'youtube:' + media.id;
  if (media.type === 'video') return 'video:' + media.url;
  if (media.type === 'kinopoisk') return 'kinopoisk:' + media.url;
  return `file:${media.name}:${media.size}`;
}

export function clock(total) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  const tail = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${m}:${tail}`;
}
