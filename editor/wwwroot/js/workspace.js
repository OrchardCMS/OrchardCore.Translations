// Operations shared by the views: loading a file with its template, turning drafts
// into new file contents, and the bulk helpers.

import { parsePo, headerFields, pluralCount } from './po.js';
import { buildRows, applyOps, pruneOps, isOrdered, isConflict, usesPluralRule, applyPluralRule } from './catalog.js';
import { parsePluralForms } from './plurals.js';
import { pluralRuleFor } from './plural-rules.js';
import { diffStat } from './diff.js';
import { drafts } from './drafts.js';

export const poPath = (culture, name) => `Localization/${culture}/${name}.po`;

/**
 * Everything the editor needs to know about one file of one culture. When `ops` holds
 * a pending plural rule update, rows and forms are those of the updated file.
 *   rule      the editor's plural rule for the culture (null when unknown)
 *   outdated  the file's Plural-Forms header differs from `rule`
 *   upgraded  rows and forms already follow `ops.plurals`
 */
export async function loadFile(app, culture, name, ops) {
  const [pot, poText] = await Promise.all([app.pot(name), app.source.readPo(culture, name)]);
  const po = poText == null ? null : parsePo(poText);
  const defaults = po ? null : await app.cultureDefaults(culture);
  const rule = pluralRuleFor(culture);
  const fileRule = po ? headerFields(po).get('Plural-Forms') ?? null : null;
  const outdated = !!(po && rule && !usesPluralRule(po, rule));
  let upgraded = false;
  if (po && ops?.plurals) {
    try {
      upgraded = applyPluralRule(po, ops.plurals);
    } catch { /* invalid pending rule: ignored */ }
  }
  const header = po ? headerFields(po).get('Plural-Forms') : defaults.pluralForms;
  let forms = null;
  let formsError = null;
  try {
    forms = parsePluralForms(header);
  } catch (e) {
    formsError = e.message;
  }
  return {
    culture, name, pot, po, poText, defaults, forms, formsError, rule, fileRule, outdated, upgraded,
    nplurals: po ? pluralCount(po) : forms?.nplurals ?? 2,
    rows: buildRows(pot, po),
    ordered: isOrdered(pot, po),
  };
}

/** The effect of a file's pending changes: old and new text, line counts, conflicts. */
export async function computeChange(app, culture, name, ops) {
  const file = await loadFile(app, culture, name, ops);
  const pruned = pruneOps(ops, file.rows, file.nplurals);
  if (pruned.reorder && file.ordered) delete pruned.reorder;
  if (pruned.plurals && !file.upgraded) delete pruned.plurals;
  const applied = applyOps({ pot: file.pot, poText: file.poText, ops: pruned, defaults: file.defaults });
  const changed = applied != null && applied !== file.poText;
  return {
    culture, name, path: poPath(culture, name), ops: pruned, changed,
    created: changed && file.poText == null,
    oldText: file.poText,
    newText: changed ? applied : file.poText,
    stat: changed ? diffStat(file.poText ?? '', applied) : { added: 0, removed: 0 },
    conflicts: file.rows.filter((r) => isConflict(r, pruned.entries[r.key], file.nplurals)).length,
  };
}

/** All pending changes that still do something, in path order. */
export async function allChanges(app, onProgress) {
  const result = [];
  for (const draft of drafts.list()) {
    const change = await computeChange(app, draft.culture, draft.name, draft.ops);
    if (change.changed) result.push(change);
    else drafts.clear(draft.culture, draft.name); // already applied upstream, or nothing left
    onProgress?.();
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

// Bulk helpers. Each mutates `ops` for one loaded file and returns how many things it queued.

export function queueRemoveDeprecated(file, ops) {
  let count = 0;
  for (const row of file.rows) {
    if (row.inPot || ops.entries[row.key]?.t === 'remove') continue;
    ops.entries[row.key] = { t: 'remove' };
    count++;
  }
  return count;
}

export function queueAddMissing(file, ops) {
  let count = 0;
  for (const row of file.rows) {
    if (!row.inPot || row.inPo || ops.entries[row.key]) continue;
    ops.entries[row.key] = { t: 'set', v: [], b: null, add: true };
    count++;
  }
  return count;
}

export function queueReorder(file, ops) {
  if (file.ordered || ops.reorder) return 0;
  ops.reorder = true;
  return 1;
}

export function queuePluralRule(file, ops) {
  if (!file.outdated || ops.plurals === file.rule) return 0;
  ops.plurals = file.rule;
  return 1;
}

const ACTIONS = {
  removeDeprecated: { queue: queueRemoveDeprecated, relevant: (stats) => !stats || stats[4] > 0 },
  addMissing: { queue: queueAddMissing, relevant: (stats) => !stats || stats[3] > 0 },
  reorder: { queue: queueReorder, relevant: () => true },
  plurals: { queue: queuePluralRule, relevant: () => true },
};

/**
 * Runs a bulk helper over every existing file of a culture and stores the result as
 * drafts. Returns { files, items }.
 */
export async function bulkCulture(app, culture, action, onProgress) {
  const { queue, relevant } = ACTIONS[action];
  await app.source.ensureStats(culture);
  const files = [...app.culture(culture).files].filter(([, stats]) => relevant(stats)).map(([name]) => name);
  const totals = { files: 0, items: 0 };
  let done = 0;
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < files.length) {
      const name = files[next++];
      const ops = drafts.get(culture, name);
      const file = await loadFile(app, culture, name, ops);
      const count = queue(file, ops);
      if (count) {
        drafts.set(culture, name, ops);
        totals.files++;
        totals.items += count;
      }
      onProgress?.(++done, files.length);
    }
  }));
  return totals;
}
