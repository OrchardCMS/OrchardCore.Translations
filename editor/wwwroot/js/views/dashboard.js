// Dashboard: one row per language.

import { h, replace, fmt, percent, progressBar } from '../dom.js';
import { drafts } from '../drafts.js';

const COLUMNS = [
  { key: 'name', label: 'Language', text: true },
  { key: 'progress', label: 'Progress', value: (t) => (t ? t.translated / (t.total || 1) : -1) },
  { key: 'translated', label: 'Translated', value: (t) => t?.translated ?? -1, title: 'Template strings with a translation' },
  { key: 'untranslated', label: 'Untranslated', value: (t) => t?.untranslated ?? -1, title: 'In the .po file with an empty or partial translation' },
  { key: 'missing', label: 'Missing', value: (t) => t?.missing ?? -1, title: 'In the template but not in the .po file yet' },
  { key: 'deprecated', label: 'Deprecated', value: (t) => t?.deprecated ?? -1, title: 'In the .po file but no longer in the template' },
];

let sort = { key: 'progress', descending: true };

export async function dashboardView(app, root, params, isCurrent) {
  const pending = new Map();
  for (const draft of drafts.list()) pending.set(draft.culture, (pending.get(draft.culture) ?? 0) + 1);

  const items = app.info.cultures.map((culture) => ({
    code: culture.code,
    name: app.cultureName(culture.code),
    totals: app.cultureTotals(culture.code),
  }));

  const summary = h('p', { class: 'muted' });
  const body = h('tbody');
  const head = h('tr');

  function renderSummary() {
    const known = items.filter((i) => i.totals);
    const translated = known.reduce((sum, i) => sum + i.totals.translated, 0);
    const all = known.length * app.totalEntries;
    replace(summary,
      `${fmt(items.length)} languages · ${fmt(app.info.templates.length)} sections · ${fmt(app.totalEntries)} strings`,
      known.length ? ` · ${percent(translated, all)} translated overall` : '',
      known.length < items.length ? ` · computing statistics (${known.length}/${items.length})…` : '');
  }

  function renderHead() {
    replace(head, COLUMNS.map((column) => h('th', {
      class: `sortable${column.text ? '' : ' num'}${column.key === 'progress' ? ' wide' : ''}`,
      title: column.title,
      onclick: () => {
        sort = { key: column.key, descending: sort.key === column.key ? !sort.descending : !column.text };
        renderHead();
        renderBody();
      },
    }, column.label, sort.key === column.key ? (sort.descending ? ' ▾' : ' ▴') : '')));
  }

  function renderBody() {
    const column = COLUMNS.find((c) => c.key === sort.key);
    const sorted = items.slice().sort((a, b) => {
      const order = column.text ? a.name.localeCompare(b.name) : column.value(a.totals) - column.value(b.totals);
      return (sort.descending ? -order : order) || a.name.localeCompare(b.name);
    });
    replace(body, sorted.map((item) => {
      const t = item.totals;
      const count = pending.get(item.code);
      return h('tr', {},
        h('td', {},
          h('a', { href: `#/${encodeURIComponent(item.code)}` }, item.name), ' ',
          h('code', { class: 'muted' }, item.code),
          count ? h('span', { class: 'pending', title: 'Files with pending changes' }, `● ${count}`) : null),
        h('td', { class: 'wide' }, t ? h('div', { class: 'progress' }, progressBar(t), h('span', { class: 'pct' }, percent(t.translated, t.total))) : h('span', { class: 'muted' }, '…')),
        h('td', { class: 'num' }, t ? fmt(t.translated) : ''),
        h('td', { class: 'num' }, t ? fmt(t.untranslated) : ''),
        h('td', { class: 'num' }, t ? fmt(t.missing) : ''),
        h('td', { class: 'num' }, t ? fmt(t.deprecated) : ''));
    }));
  }

  renderSummary();
  renderHead();
  renderBody();
  replace(root,
    h('div', { class: 'page-head' }, h('h1', {}, 'Languages')),
    summary,
    h('div', { class: 'legend' },
      h('span', { class: 'key key-translated' }, 'translated'),
      h('span', { class: 'key key-untranslated' }, 'untranslated'),
      h('span', { class: 'key key-missing' }, 'missing from the file')),
    h('table', { class: 'grid' }, h('thead', {}, head), body));

  // A local folder has no precomputed index: fill the table in as files are read.
  for (const item of items) {
    if (item.totals) continue;
    await app.source.ensureStats(item.code);
    if (!isCurrent()) return;
    item.totals = app.cultureTotals(item.code);
    renderSummary();
    renderBody();
  }
}
