// Подключает сторонний скрипт тогда, когда он понадобился, и только один раз.

const scripts = new Map();

export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => { scripts.delete(src); tag.remove(); reject(new Error('Не загрузился ' + src)); };
      document.head.append(tag);
    }));
  }
  return scripts.get(src);
}
