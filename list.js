// Общий список «хотим посмотреть».
// Удалённые записи остаются с пометкой deleted, иначе копия второго человека их вернёт.

const LIMIT = 200;

const valid = (item) => item && typeof item.id === 'string' && typeof item.text === 'string'
  && item.text.length <= 1000 && Number.isFinite(item.updated) && Number.isFinite(item.added ?? 0);

// Для каждой записи побеждает более поздняя правка.
export function mergeList(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  let changed = false;
  for (const item of incoming) {
    if (!valid(item)) continue;
    const old = byId.get(item.id);
    if (old && old.updated >= item.updated) continue;
    byId.set(item.id, item);
    changed = true;
  }
  if (!changed) return current;
  return [...byId.values()].sort((a, b) => a.added - b.added).slice(-LIMIT);
}

// новая версия записи всегда позже прежней, даже если часы у людей расходятся
export const edit = (item, patch) => ({ ...item, ...patch, updated: Math.max(Date.now(), item.updated + 1) });

export const waiting = (list) => list.filter((item) => !item.deleted && !item.done);
