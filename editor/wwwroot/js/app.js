// Application shell: source selection, routing and shared lookups.
//
// Routes:  #/                    dashboard (all languages)
//          #/<culture>           sections of a language
//          #/<culture>/<name>    editor for one section
//          #/changes             pending changes and export

import { h, replace } from './dom.js';
import { parsePo, headerFields } from './po.js';
import { HostedSource, FolderSource, folderAccessSupported, rememberFolder, rememberedFolder } from './sources.js';
import { drafts } from './drafts.js';
import { dashboardView } from './views/dashboard.js';
import { languageView } from './views/language.js';
import { editorView } from './views/editor.js';
import { changesView } from './views/changes.js';

const view = document.getElementById('view');
const crumbs = document.getElementById('crumbs');
const sourceMenu = document.getElementById('source-menu');
const sourceLabel = document.getElementById('source-label');
const sourceBody = document.getElementById('source-body');
const changesCount = document.getElementById('changes-count');

let displayNames = null;
try {
  displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
} catch { /* names from the index only */ }

export const app = {
  source: null,
  info: null,
  hostedAvailable: false,
  pots: new Map(),
  defaults: new Map(),

  async use(source) {
    const info = await source.load();
    this.source = source;
    this.info = info;
    this.templates = new Map(info.templates.map((t) => [t.name, t]));
    this.totalEntries = info.templates.reduce((sum, t) => sum + t.entries, 0);
    this.pots.clear();
    this.defaults.clear();
    renderSourceMenu();
  },

  culture(code) {
    return this.info.cultures.find((c) => c.code === code) ?? null;
  },

  cultureName(code) {
    const known = this.culture(code)?.name;
    if (known) return known;
    try {
      const name = displayNames?.of(code);
      if (name && name !== code) return name;
    } catch { /* not a valid tag */ }
    return code;
  },

  /** Parsed template, or null when `name` has no .pot. */
  async pot(name) {
    if (!this.pots.has(name)) {
      const text = this.templates.has(name) ? await this.source.readPot(name) : null;
      this.pots.set(name, text == null ? null : parsePo(text));
    }
    return this.pots.get(name);
  },

  /** Plural rule and language for a file that has to be created, from a sibling file. */
  async cultureDefaults(code) {
    if (!this.defaults.has(code)) {
      const result = { pluralForms: 'nplurals=2; plural=(n != 1);', language: code.replace(/-/g, '_') };
      const names = [...(this.culture(code)?.files.keys() ?? [])];
      const sibling = names.find((n) => this.templates.has(n)) ?? names[0];
      const text = sibling ? await this.source.readPo(code, sibling) : null;
      if (text) {
        const fields = headerFields(parsePo(text));
        result.pluralForms = fields.get('Plural-Forms') || result.pluralForms;
        result.language = fields.get('Language') || result.language;
      }
      this.defaults.set(code, result);
    }
    return this.defaults.get(code);
  },

  /**
   * Totals for a culture, or null while a file's statistics are still unknown.
   * Templates without a .po file count as missing.
   */
  cultureTotals(code) {
    const culture = this.culture(code);
    const totals = { translated: 0, partial: 0, empty: 0, missing: 0, deprecated: 0, total: this.totalEntries, files: culture.files.size };
    for (const stats of culture.files.values()) {
      if (!stats) return null;
      totals.translated += stats[0];
      totals.partial += stats[1];
      totals.empty += stats[2];
      totals.missing += stats[3];
      totals.deprecated += stats[4];
    }
    for (const template of this.info.templates) if (!culture.files.has(template.name)) totals.missing += template.entries;
    totals.untranslated = totals.partial + totals.empty;
    return totals;
  },

  setCrumbs(...items) {
    replace(crumbs, items.map((item) => [h('span', { class: 'sep' }, '/'), item.href ? h('a', { href: item.href }, item.text) : h('span', {}, item.text)]));
  },

  refresh: () => render(),
};

// ---- Source menu -----------------------------------------------------------

async function openFolder(handle) {
  await app.use(new FolderSource(handle));
  await rememberFolder(handle);
  sourceMenu.open = false;
  await render();
}

async function pickFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'po-editor', mode: 'readwrite' });
  } catch {
    return; // cancelled
  }
  await guarded(() => openFolder(handle));
}

async function reopenFolder(handle) {
  await guarded(async () => {
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
    await openFolder(handle);
  });
}

async function useHosted() {
  await guarded(async () => {
    await app.use(new HostedSource());
    sourceMenu.open = false;
    await render();
  });
}

async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    showError(e);
  }
}

async function renderSourceMenu() {
  sourceLabel.textContent = app.source?.label ?? 'No source';
  const remembered = folderAccessSupported() ? await rememberedFolder() : null;
  const items = [];
  if (app.source?.kind === 'hosted') {
    items.push(h('p', { class: 'muted' }, 'You are editing a read-only copy. Changes are kept in this browser and exported as a patch or zip.'));
  } else if (app.source?.kind === 'folder') {
    items.push(h('p', { class: 'muted' }, 'Changes are written to the files of this folder when you save them. Commit and push with git.'));
  }
  if (folderAccessSupported()) {
    items.push(h('button', { class: 'btn', onclick: pickFolder }, 'Open local folder…'));
    if (remembered && !(app.source?.kind === 'folder' && app.source.handle === remembered)) {
      items.push(h('button', { class: 'btn', onclick: () => reopenFolder(remembered) }, `Reopen “${remembered.name}”`));
    }
  } else {
    items.push(h('p', { class: 'muted' }, 'Editing a local clone directly needs Chrome or Edge (File System Access API).'));
  }
  if (app.source?.kind === 'folder' && app.hostedAvailable) {
    items.push(h('button', { class: 'btn', onclick: useHosted }, 'Use the hosted copy'));
  }
  replace(sourceBody, items);
}

// ---- Routing ---------------------------------------------------------------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { view: dashboardView };
  if (parts[0] === 'changes' && parts.length === 1) return { view: changesView };
  if (parts.length === 1) return { view: languageView, culture: parts[0] };
  return { view: editorView, culture: parts[0], name: parts.slice(1).join('/') };
}

function showError(error) {
  console.error(error);
  replace(view, h('div', { class: 'notice notice-error' }, h('strong', {}, 'Something went wrong. '), String(error?.message ?? error)));
}

let dispose = null;
let generation = 0;

async function render() {
  const mine = ++generation;
  try {
    dispose?.();
  } catch (e) {
    console.error(e);
  }
  dispose = null;
  app.setCrumbs();

  if (!app.source) {
    replace(view, h('section', { class: 'welcome' },
      h('h1', {}, 'Orchard Core translations'),
      h('p', {}, 'No hosted copy of the translations is available here. Open your clone of the repository to edit its .po files directly.'),
      folderAccessSupported()
        ? h('button', { class: 'btn btn-primary', onclick: pickFolder }, 'Open local folder…')
        : h('p', { class: 'notice' }, 'This needs Chrome or Edge (File System Access API).')));
    return;
  }

  const { view: target, ...params } = route();
  if (params.culture && !app.culture(params.culture)) {
    replace(view, h('div', { class: 'notice' }, `There is no “${params.culture}” language. `, h('a', { href: '#/' }, 'Back to all languages')));
    return;
  }

  const root = h('div', { class: 'page' }, h('p', { class: 'muted' }, 'Loading…'));
  replace(view, root);
  window.scrollTo(0, 0);
  try {
    const cleanup = await target(app, root, params, () => mine === generation);
    if (mine === generation) dispose = cleanup ?? null;
    else cleanup?.();
  } catch (e) {
    if (mine === generation) showError(e);
  }
}

function updateChangesCount() {
  const count = drafts.list().length;
  changesCount.hidden = count === 0;
  changesCount.textContent = String(count);
}

// ---- Start -----------------------------------------------------------------

drafts.subscribe(updateChangesCount);
updateChangesCount();
window.addEventListener('hashchange', render);
document.addEventListener('click', (event) => {
  if (sourceMenu.open && !sourceMenu.contains(event.target)) sourceMenu.open = false;
});

// For automated tests: open a directory handle without the native picker.
window.translationEditor = { app, openFolder };

try {
  await app.use(new HostedSource());
  app.hostedAvailable = true;
} catch (e) {
  console.info('No hosted copy:', e.message);
  await renderSourceMenu();
}
await render();
