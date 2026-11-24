// Pending changes, one localStorage item per file. Only the changed strings are
// stored (see catalog.js for the shape), so drafts stay small and can be re-applied
// when the underlying files move on.

import { isEmptyOps } from './catalog.js';

const PREFIX = 'po-editor:draft:';
const memory = new Map(); // fallback when localStorage is unavailable
const listeners = new Set();

const storageKey = (culture, name) => `${PREFIX}${culture}/${name}`;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
}

function keys() {
  const found = new Set(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) found.add(key);
    }
  } catch { /* storage blocked: memory only */ }
  return [...found].sort();
}

const notify = () => listeners.forEach((fn) => fn());

export const drafts = {
  get(culture, name) {
    const ops = read(storageKey(culture, name));
    return { entries: ops?.entries ?? {}, ...(ops?.reorder ? { reorder: true } : {}), ...(ops?.plurals ? { plurals: ops.plurals } : {}) };
  },
  set(culture, name, ops) {
    write(storageKey(culture, name), isEmptyOps(ops) ? null : ops);
    notify();
  },
  clear(culture, name) {
    write(storageKey(culture, name), null);
    notify();
  },
  clearAll() {
    for (const key of keys()) write(key, null);
    notify();
  },
  /** [{ culture, name, ops }] */
  list() {
    const result = [];
    for (const key of keys()) {
      const ops = read(key);
      if (isEmptyOps(ops)) continue;
      const path = key.slice(PREFIX.length);
      const slash = path.indexOf('/');
      result.push({ culture: path.slice(0, slash), name: path.slice(slash + 1), ops });
    }
    return result;
  },
  has(culture, name) {
    return !isEmptyOps(read(storageKey(culture, name)));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Keep several tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(PREFIX)) notify();
  });
}
