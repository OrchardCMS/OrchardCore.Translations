// Section editor: every string of one .pot file for one culture.

import { h, replace, fmt, count as countOf, visibleText } from '../dom.js';
import { drafts } from '../drafts.js';
import { describeForms, parseRange } from '../plurals.js';
import {
  computeStats, rowStatus, isChanged, isConflict, currentValues, baseValues, formCount,
  sameValues, pruneOps, isEmptyOps,
} from '../catalog.js';
import { loadFile, queueRemoveDeprecated, queueAddMissing } from '../workspace.js';

const PAGE = 50;

const STATUS_LABEL = {
  translated: 'translated',
  partial: 'partly translated',
  empty: 'untranslated',
  missing: 'not in file',
  deprecated: 'deprecated',
  removed: 'will be removed',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'todo', label: 'Untranslated' },
  { key: 'translated', label: 'Translated' },
  { key: 'deprecated', label: 'Deprecated' },
  { key: 'changed', label: 'Changed' },
  { key: 'warnings', label: 'Warnings' },
];

const placeholders = (text) => new Set((text.match(/\{\d+(?:[,:][^{}]*)?\}/g) ?? []).map((p) => /\d+/.exec(p)[0]));
const edgeSpace = (text) => [/^\s*/.exec(text)[0], /\s*$/.exec(text)[0]].join('|');

/** Likely mistakes in a translation, compared with its source. */
function warningsFor(row, values) {
  const warnings = [];
  if (!row.inPot) return warnings;
  if (row.idPlural === null) {
    const value = values[0];
    if (!value) return warnings;
    const wanted = placeholders(row.id);
    const used = placeholders(value);
    if (wanted.size !== used.size || [...wanted].some((p) => !used.has(p))) {
      warnings.push(`Placeholders differ from the source (${[...wanted].map((p) => `{${p}}`).join(', ') || 'none'}).`);
    }
    if (edgeSpace(row.id) !== edgeSpace(value)) warnings.push('Leading or trailing whitespace differs from the source.');
  } else {
    const allowed = new Set([...placeholders(row.id), ...placeholders(row.idPlural)]);
    values.forEach((value, i) => {
      if ([...placeholders(value)].some((p) => !allowed.has(p))) warnings.push(`Form ${i} uses a placeholder the source does not have.`);
    });
  }
  return warnings;
}

export async function editorView(app, root, { culture, name }, isCurrent) {
  const cultureName = app.cultureName(culture);
  app.setCrumbs({ text: cultureName, href: `#/${encodeURIComponent(culture)}` }, { text: name });

  const file = await loadFile(app, culture, name);
  if (!isCurrent()) return;
  if (!file.pot && !file.po) {
    replace(root, h('div', { class: 'notice' }, `There is no “${name}” section. `, h('a', { href: `#/${encodeURIComponent(culture)}` }, `Back to ${cultureName}`)));
    return;
  }

  const { rows, nplurals } = file;
  let ops = pruneOps(drafts.get(culture, name), rows, nplurals);
  if (ops.reorder && file.ordered) delete ops.reorder;

  // ---- Saving drafts ----
  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (isEmptyOps(ops) && !drafts.has(culture, name)) return;
    drafts.set(culture, name, ops);
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  };
  const onUnload = () => { if (saveTimer) saveNow(); };
  window.addEventListener('pagehide', onUnload);

  // ---- Row state helpers ----
  const opOf = (row) => ops.entries[row.key];
  const valuesOf = (row) => currentValues(row, opOf(row), nplurals);
  const statusOf = (row) => rowStatus(row, opOf(row), nplurals);

  function setValues(row, values) {
    const previous = opOf(row);
    const base = baseValues(row, nplurals);
    const keepEmptyEntry = !row.inPo && previous?.add;
    const untouched = row.inPo ? sameValues(values, base) : values.every((v) => v === '') && !keepEmptyEntry;
    if (untouched) delete ops.entries[row.key];
    else ops.entries[row.key] = { t: 'set', v: values, b: previous?.t === 'set' ? previous.b : row.inPo ? base : null, ...(keepEmptyEntry ? { add: true } : {}) };
    scheduleSave();
  }

  // Translations of the same source text elsewhere in the file (often a renamed context).
  const sameSource = new Map();
  const sourceKey = (row) => row.id + '\u0000' + (row.idPlural ?? '');
  for (const row of rows) {
    const values = baseValues(row, nplurals);
    if (!row.inPo || values.some((v) => v === '')) continue;
    const list = sameSource.get(sourceKey(row)) ?? [];
    if (!list.some((v) => sameValues(v.values, values))) list.push({ values, from: row });
    sameSource.set(sourceKey(row), list);
  }
  const suggestionsFor = (row) => (sameSource.get(sourceKey(row)) ?? [])
    .filter((s) => s.from !== row && s.values.length === formCount(row, nplurals))
    .slice(0, 3);

  // ---- Header ----
  const chips = h('div', { class: 'chips' });
  const filterBar = h('div', { class: 'filters', role: 'tablist' });
  const list = h('div', { class: 'rows' });
  const bulkBar = h('span', { class: 'bulk' });
  const search = h('input', { type: 'search', placeholder: 'Search strings', title: 'Search in source text, translations and contexts', oninput: () => renderList() });
  let filter = 'all';

  const matches = {
    all: () => true,
    todo: (row) => ['missing', 'empty', 'partial'].includes(statusOf(row)),
    translated: (row) => statusOf(row) === 'translated',
    deprecated: (row) => !row.inPot,
    changed: (row) => isChanged(row, opOf(row), nplurals),
    warnings: (row) => warningsFor(row, valuesOf(row)).length > 0,
  };

  function renderCounters() {
    const stats = computeStats(rows, ops.entries, nplurals);
    const todo = stats.missing + stats.empty + stats.partial;
    replace(chips,
      stats.total ? h('span', { class: 'chip chip-translated' }, `${fmt(stats.translated)} of ${fmt(stats.total)} translated`) : null,
      todo ? h('span', { class: 'chip chip-untranslated' }, `${fmt(todo)} untranslated`) : null,
      stats.deprecated ? h('span', { class: 'chip chip-deprecated' }, `${fmt(stats.deprecated)} deprecated`) : null,
      stats.changed || ops.reorder ? h('a', { class: 'chip chip-changed', href: '#/changes' }, countOf(stats.changed + (ops.reorder ? 1 : 0), 'pending change')) : null);
    replace(filterBar, FILTERS.map((f) => {
      const count = rows.filter(matches[f.key]).length;
      return h('button', {
        class: `filter${filter === f.key ? ' active' : ''}`, role: 'tab', 'aria-selected': String(filter === f.key),
        onclick: () => { filter = f.key; renderCounters(); renderList(); },
      }, f.label, h('span', { class: 'count' }, fmt(count)));
    }));

    const deprecated = rows.filter((r) => !r.inPot && opOf(r)?.t !== 'remove').length;
    const missing = rows.filter((r) => r.inPot && !r.inPo && !opOf(r)).length;
    replace(bulkBar,
      deprecated ? h('button', { class: 'btn', title: 'Queue the removal of every deprecated entry of this file', onclick: () => bulk(queueRemoveDeprecated) }, `Remove deprecated (${fmt(deprecated)})`) : null,
      missing ? h('button', { class: 'btn', title: 'Add the template strings this file lacks, with an empty translation', onclick: () => bulk(queueAddMissing) }, `Add missing (${fmt(missing)})`) : null,
      !file.ordered ? h('button', {
        class: `btn${ops.reorder ? ' active' : ''}`, title: 'Entries of this file are not in template order',
        onclick: () => { if (ops.reorder) delete ops.reorder; else ops.reorder = true; saveNow(); renderCounters(); },
      }, ops.reorder ? '✓ Will match template order' : 'Match template order') : null,
      !isEmptyOps(ops) ? h('button', {
        class: 'btn btn-quiet', title: 'Forget every pending change of this file',
        onclick: () => { if (confirm('Discard all pending changes of this file?')) { ops = { entries: {} }; saveNow(); renderCounters(); renderList(); } },
      }, 'Discard changes') : null);
  }

  function bulk(queue) {
    queue(file, ops);
    saveNow();
    renderCounters();
    renderList();
  }

  let countersQueued = false;
  function queueCounters() {
    if (countersQueued) return;
    countersQueued = true;
    requestAnimationFrame(() => { countersQueued = false; if (isCurrent()) renderCounters(); });
  }

  // ---- Rows ----
  function renderRow(row) {
    const el = h('article', { class: 'row' });
    const count = formCount(row, nplurals);
    const plural = row.idPlural !== null;
    const labels = plural && row.inPot && file.forms ? describeForms(file.forms, parseRange(row.flags)) : null;
    const badge = h('span', { class: 'badge' });
    const marks = h('span', { class: 'marks' });
    const actions = h('div', { class: 'row-actions' });
    const notes = h('div', { class: 'row-notes' });

    const fields = Array.from({ length: count }, (_, i) => h('textarea', {
      lang: culture, dir: 'auto', spellcheck: true, rows: 1,
      readOnly: !row.inPot,
      'aria-label': plural ? `Translation, form ${i}` : 'Translation',
      oninput: () => {
        const values = fields.map((f) => f.value);
        setValues(row, values);
        refresh(false);
        queueCounters();
      },
      onkeydown: (event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const all = [...list.querySelectorAll('textarea:not([readonly])')];
        all[all.indexOf(event.target) + 1]?.focus();
      },
    }));

    function fill(values) {
      setValues(row, values);
      refresh(true);
      queueCounters();
    }

    function refresh(writeFields) {
      const op = opOf(row);
      const status = statusOf(row);
      const values = valuesOf(row);
      const changed = isChanged(row, op, nplurals);
      el.className = `row row-${status}${changed ? ' row-changed' : ''}`;
      badge.textContent = STATUS_LABEL[status];
      badge.className = `badge badge-${status}`;
      replace(marks,
        changed ? h('span', { class: 'mark mark-changed', title: 'Pending change' }, 'edited') : null,
        isConflict(row, op, nplurals) ? h('span', { class: 'mark mark-conflict', title: `The file now says: ${baseValues(row, nplurals).join(' | ')}` }, 'file changed since your edit') : null);
      if (writeFields) fields.forEach((field, i) => { field.value = values[i]; });

      const buttons = [];
      if (!row.inPot) {
        buttons.push(op?.t === 'remove'
          ? h('button', { class: 'link', onclick: () => { delete ops.entries[row.key]; scheduleSave(); refresh(false); queueCounters(); } }, 'Keep')
          : h('button', { class: 'link danger', onclick: () => { ops.entries[row.key] = { t: 'remove' }; scheduleSave(); refresh(false); queueCounters(); } }, 'Remove'));
      } else {
        if (changed) buttons.push(h('button', { class: 'link', title: 'Back to what the file has', onclick: () => { delete ops.entries[row.key]; scheduleSave(); refresh(true); queueCounters(); } }, 'Revert'));
        if (values.every((v) => v === '')) {
          for (const suggestion of suggestionsFor(row)) {
            const text = suggestion.values.join(' | ');
            buttons.push(h('button', {
              class: 'link', title: `Same source text is translated under “${suggestion.from.ctxt}”${suggestion.from.inPot ? '' : ' (deprecated)'}`,
              onclick: () => fill(suggestion.values.slice()),
            }, `Use “${text.length > 60 ? text.slice(0, 60) + '…' : text}”`));
          }
          if (!plural) buttons.push(h('button', { class: 'link', title: 'Start from the source text', onclick: () => fill([row.id]) }, 'Copy source'));
        }
      }
      replace(actions, buttons);
      replace(notes, warningsFor(row, values).map((w) => h('div', { class: 'warning' }, '⚠ ', w)));
    }

    const source = (label, text) => h('div', { class: 'source' }, label ? h('span', { class: 'label' }, label) : null, h('div', { class: 'msg' }, visibleText(text)));
    el.append(
      h('div', { class: 'row-head' },
        h('code', { class: 'ctx', title: 'Context (msgctxt)' }, row.ctxt ?? ''),
        badge, marks,
        row.flags.map((flag) => h('span', { class: 'flag' }, flag))),
      h('div', { class: 'row-cols' },
        h('div', { class: 'col-source' },
          source(plural ? 'One' : null, row.id),
          plural ? source('Other', row.idPlural) : null,
          row.extracted.map((note) => h('div', { class: 'note' }, note)),
          row.refs.length ? h('div', { class: 'refs' }, row.refs.join(' ')) : null),
        h('div', { class: 'col-target' },
          fields.map((field, i) => h('label', { class: 'field' },
            plural ? h('span', { class: 'label' }, `Form ${i}`, labels?.[i] ? h('span', { class: 'label-detail' }, ` · ${labels[i]}`) : null) : null,
            field)),
          notes, actions)));
    refresh(true);
    return el;
  }

  let observer = null;
  function renderList() {
    observer?.disconnect();
    const query = search.value.trim().toLowerCase();
    const visible = rows.filter((row) => {
      if (!matches[filter](row)) return false;
      if (!query) return true;
      return [row.id, row.idPlural ?? '', row.ctxt ?? '', ...valuesOf(row)].some((text) => text.toLowerCase().includes(query));
    });
    replace(list);
    if (!visible.length) {
      list.append(h('p', { class: 'muted empty' }, rows.length ? 'No string matches.' : 'This file has no entries.'));
      return;
    }
    let shown = 0;
    const sentinel = h('div', { class: 'sentinel' });
    const more = () => {
      const next = visible.slice(shown, shown + PAGE);
      shown += next.length;
      sentinel.before(...next.map(renderRow));
      if (shown >= visible.length) { observer.disconnect(); sentinel.remove(); }
      else sentinel.textContent = `Showing ${fmt(shown)} of ${fmt(visible.length)}…`;
    };
    list.append(sentinel);
    observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: '800px' });
    more();
    if (shown < visible.length) observer.observe(sentinel);
  }

  // ---- Page ----
  const notices = [];
  if (!file.pot) notices.push(h('div', { class: 'notice' }, 'This file has no template any more: all of its entries are deprecated and can only be removed.'));
  if (file.pot && !file.po) notices.push(h('div', { class: 'notice' }, `${cultureName} has no ${name}.po yet. It is created when you translate a string, with the plural rule “${file.defaults.pluralForms}”.`));
  if (file.formsError) notices.push(h('div', { class: 'notice notice-error' }, `The Plural-Forms header of this file cannot be read (${file.formsError}); plural forms are shown without examples.`));

  renderCounters();
  renderList();
  replace(root,
    h('div', { class: 'page-head' },
      h('h1', {}, name, ' ', h('span', { class: 'muted' }, cultureName)),
      chips),
    notices,
    h('div', { class: 'toolbar sticky' }, search, filterBar, h('span', { class: 'spacer' }), bulkBar),
    list,
    h('p', { class: 'muted hint' }, 'Ctrl+Enter moves to the next translation. Changes are kept in this browser until you save or export them from ', h('a', { href: '#/changes' }, 'Changes'), '.'));

  return () => {
    observer?.disconnect();
    window.removeEventListener('pagehide', onUnload);
    if (saveTimer) saveNow();
  };
}
