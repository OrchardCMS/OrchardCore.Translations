// Language view: the sections (.pot files) of one culture.

import { h, replace, fmt, count, percent, progressBar } from '../dom.js';
import { drafts } from '../drafts.js';
import { bulkCulture } from '../workspace.js';

let needsWorkOnly = false;

export async function languageView(app, root, { culture }, isCurrent) {
  const name = app.cultureName(culture);
  app.setCrumbs({ text: name });
  replace(root, h('p', { class: 'muted' }, 'Reading files…'));
  await app.source.ensureStats(culture);
  if (!isCurrent()) return;

  const files = app.culture(culture).files;
  const totals = app.cultureTotals(culture);
  const link = (section) => `#/${encodeURIComponent(culture)}/${encodeURIComponent(section)}`;

  const sections = app.info.templates.map((template) => {
    const stats = files.get(template.name);
    return {
      name: template.name,
      exists: !!stats,
      total: template.entries,
      translated: stats?.[0] ?? 0,
      untranslated: stats ? stats[1] + stats[2] : 0,
      missing: stats ? stats[3] : template.entries,
      deprecated: stats?.[4] ?? 0,
    };
  });
  const orphans = [...files].filter(([file]) => !app.templates.has(file)).map(([file, stats]) => ({ name: file, deprecated: stats[4] }));
  const needsWork = (s) => s.untranslated + s.missing + s.deprecated > 0;

  const status = h('div', { class: 'notice', hidden: true });
  const body = h('tbody');
  const filter = h('input', { type: 'search', placeholder: 'Filter sections', oninput: renderBody });
  const onlyWork = h('input', { type: 'checkbox', checked: needsWorkOnly, onchange: () => { needsWorkOnly = onlyWork.checked; renderBody(); } });

  function renderBody() {
    const query = filter.value.trim().toLowerCase();
    const visible = sections.filter((s) => (!query || s.name.toLowerCase().includes(query)) && (!needsWorkOnly || needsWork(s)));
    replace(body, visible.length ? visible.map((s) => h('tr', {},
      h('td', {},
        h('a', { href: link(s.name) }, s.name),
        s.exists ? null : h('span', { class: 'tag' }, 'no file yet'),
        drafts.has(culture, s.name) ? h('span', { class: 'pending', title: 'Pending changes' }, '●') : null),
      h('td', { class: 'wide' }, h('div', { class: 'progress' }, progressBar(s), h('span', { class: 'pct' }, percent(s.translated, s.total)))),
      h('td', { class: 'num' }, fmt(s.translated)),
      h('td', { class: 'num' }, s.untranslated ? fmt(s.untranslated) : ''),
      h('td', { class: 'num' }, s.missing ? fmt(s.missing) : ''),
      h('td', { class: 'num' }, s.deprecated ? fmt(s.deprecated) : ''))) : h('tr', {}, h('td', { colSpan: 6, class: 'muted' }, 'No section matches.')));
  }

  async function bulk(action, describe) {
    for (const button of buttons) button.disabled = true;
    status.hidden = false;
    try {
      const result = await bulkCulture(app, culture, action, (done, total) => { status.textContent = `Reading files… ${done}/${total}`; });
      replace(status, result.items ? describe(result) : 'Nothing to do.', result.items ? [' ', h('a', { href: '#/changes' }, 'Review the changes')] : null);
    } catch (e) {
      status.textContent = `Failed: ${e.message}`;
    }
    for (const button of buttons) button.disabled = false;
    renderBody();
  }

  const buttons = [
    h('button', {
      class: 'btn', disabled: totals.deprecated === 0,
      title: 'Queue the removal of every entry that is no longer in its template',
      onclick: () => bulk('removeDeprecated', (r) => `Queued the removal of ${count(r.items, 'deprecated entry', 'deprecated entries')} in ${count(r.files, 'file')}.`),
    }, `Remove deprecated (${fmt(totals.deprecated)})`),
    h('button', {
      class: 'btn',
      title: 'Queue adding every template string that existing files lack, with an empty translation',
      onclick: () => bulk('addMissing', (r) => `Queued ${count(r.items, 'missing entry', 'missing entries')} in ${count(r.files, 'file')}.`),
    }, 'Add missing entries'),
    h('button', {
      class: 'btn',
      title: 'Queue reordering of files whose entries are not in template order',
      onclick: () => bulk('reorder', (r) => `Queued reordering of ${count(r.files, 'file')}.`),
    }, 'Match template order'),
  ];

  renderBody();
  replace(root,
    h('div', { class: 'page-head' },
      h('h1', {}, name, ' ', h('code', { class: 'muted' }, culture)),
      h('div', { class: 'chips' },
        h('span', { class: 'chip chip-translated' }, `${fmt(totals.translated)} translated (${percent(totals.translated, totals.total)})`),
        h('span', { class: 'chip chip-untranslated' }, `${fmt(totals.untranslated)} untranslated`),
        h('span', { class: 'chip chip-missing' }, `${fmt(totals.missing)} missing`),
        h('span', { class: 'chip chip-deprecated' }, `${fmt(totals.deprecated)} deprecated`))),
    h('div', { class: 'toolbar' }, filter, h('label', { class: 'check' }, onlyWork, ' Needs work only'), h('span', { class: 'spacer' }), buttons),
    status,
    h('table', { class: 'grid' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Section'), h('th', { class: 'wide' }, 'Progress'), h('th', { class: 'num' }, 'Translated'),
        h('th', { class: 'num' }, 'Untranslated'), h('th', { class: 'num' }, 'Missing'), h('th', { class: 'num' }, 'Deprecated'))),
      body),
    orphans.length ? [
      h('h2', {}, 'Files without a template'),
      h('p', { class: 'muted' }, 'These .po files have no .pot any more, so every entry in them is deprecated.'),
      h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', { class: 'num' }, 'Entries'))),
        h('tbody', {}, orphans.map((o) => h('tr', {},
          h('td', {}, h('a', { href: link(o.name) }, o.name), drafts.has(culture, o.name) ? h('span', { class: 'pending' }, '●') : null),
          h('td', { class: 'num' }, fmt(o.deprecated)))))),
    ] : null);
}
