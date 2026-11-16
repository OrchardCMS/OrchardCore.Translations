// Where the catalogs come from.
//
//   HostedSource  reads the copy deployed next to the site (read-only, with a
//                 precomputed statistics index).
//   FolderSource  reads and writes a local clone through the File System Access API
//                 (Chromium browsers) and computes statistics in the browser.
//
// Both expose: kind, label, canWrite, load(), readPot(name), readPo(culture, name),
// ensureStats(culture, onProgress), and FolderSource adds writePo().
//
// load() returns { commit, templates: [{ name, entries }], cultures: [{ code, name, files: Map<name, stats|null> }] }
// where stats is [translated, partial, empty, missing, deprecated].

import { parsePo, entryBlocks, pluralCount } from './po.js';
import { buildRows, computeStats, statsArray } from './catalog.js';

export function fileStats(pot, poText) {
  const po = parsePo(poText);
  return statsArray(computeStats(buildRows(pot, po), {}, pluralCount(po)));
}

export class HostedSource {
  kind = 'hosted';
  canWrite = false;

  constructor(base = './') {
    this.base = base;
  }

  async load() {
    const response = await fetch(`${this.base}data/index.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`The translation index is not available (HTTP ${response.status}).`);
    const index = await response.json();
    this.commit = index.commit || '';
    this.label = this.commit ? `Hosted copy · ${this.commit.slice(0, 7)}` : 'Hosted copy';
    this.info = {
      commit: this.commit,
      templates: index.templates,
      cultures: index.cultures.map((c) => ({ code: c.code, name: c.name || '', files: new Map(Object.entries(c.files)) })),
    };
    return this.info;
  }

  async #text(path) {
    const response = await fetch(this.base + path, { cache: 'no-cache' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cannot load ${path} (HTTP ${response.status}).`);
    return response.text();
  }

  readPot(name) {
    return this.info.templates.some((t) => t.name === name) ? this.#text(`Localization/${encodeURIComponent(name)}.pot`) : Promise.resolve(null);
  }

  readPo(culture, name) {
    const files = this.info.cultures.find((c) => c.code === culture)?.files;
    return files?.has(name) ? this.#text(`Localization/${encodeURIComponent(culture)}/${encodeURIComponent(name)}.po`) : Promise.resolve(null);
  }

  async ensureStats() { /* the index already has them */ }
}

export const folderAccessSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export class FolderSource {
  kind = 'folder';
  canWrite = true;

  constructor(handle) {
    this.handle = handle;
    this.label = `Local folder · ${handle.name}`;
    this.pots = new Map(); // name → parsed template
  }

  async load() {
    // Accept either the repository root or its Localization folder.
    let localization = this.handle;
    let root = null;
    try {
      localization = await this.handle.getDirectoryHandle('Localization');
      root = this.handle;
    } catch { /* the picked folder may be Localization itself */ }

    const templates = [];
    const cultures = [];
    for await (const [name, entry] of localization.entries()) {
      if (entry.kind === 'file' && name.endsWith('.pot')) templates.push({ name: name.slice(0, -4), handle: entry });
      else if (entry.kind === 'directory' && !name.startsWith('.')) cultures.push({ code: name, handle: entry });
    }
    if (!templates.length) throw new Error('No .pot files found. Pick the repository folder or its "Localization" folder.');
    templates.sort((a, b) => a.name.localeCompare(b.name));
    cultures.sort((a, b) => a.code.localeCompare(b.code));

    const names = new Map();
    if (root) {
      try {
        const json = JSON.parse(await (await (await root.getFileHandle('cultures.json')).getFile()).text());
        for (const c of json.cultures ?? []) names.set(c.folder, c['display-name']);
      } catch { /* optional */ }
    }

    this.localization = localization;
    this.potHandles = new Map(templates.map((t) => [t.name, t.handle]));
    const templateInfo = [];
    for (const t of templates) {
      const pot = parsePo(await (await t.handle.getFile()).text());
      this.pots.set(t.name, pot);
      templateInfo.push({ name: t.name, entries: entryBlocks(pot).length });
    }

    this.cultureHandles = new Map();
    const cultureInfo = [];
    for (const c of cultures) {
      const files = new Map();
      for await (const [name, entry] of c.handle.entries()) {
        if (entry.kind === 'file' && name.endsWith('.po')) files.set(name.slice(0, -3), null);
      }
      this.cultureHandles.set(c.code, c.handle);
      cultureInfo.push({ code: c.code, name: names.get(c.code) ?? '', files: new Map([...files].sort((a, b) => a[0].localeCompare(b[0]))) });
    }

    this.commit = '';
    this.info = { commit: '', templates: templateInfo, cultures: cultureInfo };
    return this.info;
  }

  async readPot(name) {
    const handle = this.potHandles.get(name);
    return handle ? (await handle.getFile()).text() : null;
  }

  async readPo(culture, name) {
    const directory = this.cultureHandles.get(culture);
    if (!directory) return null;
    try {
      return await (await (await directory.getFileHandle(`${name}.po`)).getFile()).text();
    } catch (e) {
      if (e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async writePo(culture, name, text) {
    let directory = this.cultureHandles.get(culture);
    if (!directory) {
      directory = await this.localization.getDirectoryHandle(culture, { create: true });
      this.cultureHandles.set(culture, directory);
    }
    const handle = await directory.getFileHandle(`${name}.po`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    const files = this.info.cultures.find((c) => c.code === culture)?.files;
    files?.set(name, fileStats(this.pots.get(name) ?? null, text));
  }

  /** Computes the statistics of a culture's files that are not known yet. */
  async ensureStats(culture, onProgress) {
    const files = this.info.cultures.find((c) => c.code === culture)?.files;
    if (!files) return;
    for (const [name, stats] of files) {
      if (stats) continue;
      const text = await this.readPo(culture, name);
      files.set(name, text == null ? [0, 0, 0, 0, 0] : fileStats(this.pots.get(name) ?? null, text));
      onProgress?.();
    }
  }
}

// The picked folder is remembered so it can be reopened with one click.
const DB = 'po-editor';
const STORE = 'handles';

function store(mode) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.transaction(STORE, mode).objectStore(STORE));
  });
}

export async function rememberFolder(handle) {
  try {
    (await store('readwrite')).put(handle, 'root');
  } catch { /* convenience only */ }
}

export async function rememberedFolder() {
  try {
    const objectStore = await store('readonly');
    return await new Promise((resolve) => {
      const request = objectStore.get('root');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
