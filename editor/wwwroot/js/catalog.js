// Merges a template (.pot) with a translation file (.po) into editor rows, computes
// statistics, and applies pending changes ("ops") to produce the new file text.
//
// Ops for one file: { entries: { [key]: op }, reorder?: true, plurals?: string }
//   op = { t: 'set', v: string[], b: string[] | null, add?: true }  translation (b = value seen when edited)
//      | { t: 'remove' }                                            delete the entry
//   plurals: the Plural-Forms value to update the file to (see applyPluralRule)

import {
  parsePo, serializePo, blockKey, headerBlock, headerFields, pluralCount, setMsgstr, setHeaderField,
  adoptTemplateShape, entryFromTemplate, insertAfter, removeBlock, createFromTemplate,
} from './po.js';
import { parsePluralForms, sameForms, sameRule, formMapping } from './plurals.js';

export const STAT_KEYS = ['translated', 'partial', 'empty', 'missing', 'deprecated'];

export function normalize(values, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(values?.[i] ?? '');
  return out;
}

export const sameValues = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Template entries in template order, then entries that only exist in the .po. */
export function buildRows(pot, po) {
  const translated = new Map();
  if (po) for (const b of po.blocks) if (b.kind === 'entry' && !translated.has(blockKey(b))) translated.set(blockKey(b), b);
  const rows = [];
  const seen = new Set();
  if (pot) {
    for (const t of pot.blocks) {
      if (t.kind !== 'entry') continue;
      const key = blockKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const b = translated.get(key);
      rows.push({
        key, ctxt: t.ctxt, id: t.id, idPlural: t.idPlural,
        extracted: t.extracted, refs: t.refs, flags: t.flags,
        inPot: true, inPo: !!b, base: b ? b.str.slice() : [],
      });
    }
  }
  if (po) {
    for (const b of po.blocks) {
      if (b.kind !== 'entry') continue;
      const key = blockKey(b);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key, ctxt: b.ctxt, id: b.id, idPlural: b.idPlural,
        extracted: b.extracted, refs: b.refs, flags: b.flags,
        inPot: false, inPo: true, base: b.str.slice(),
      });
    }
  }
  return rows;
}

/** Number of translation fields a row has. */
export const formCount = (row, nplurals) => (row.idPlural === null ? 1 : row.inPot ? nplurals : Math.max(row.base.length, 1));

export const baseValues = (row, nplurals) => normalize(row.base, formCount(row, nplurals));

export function currentValues(row, op, nplurals) {
  return op?.t === 'set' ? normalize(op.v, formCount(row, nplurals)) : baseValues(row, nplurals);
}

/** translated | partial | empty | missing | deprecated | removed */
export function rowStatus(row, op, nplurals) {
  if (!row.inPot) return op?.t === 'remove' ? 'removed' : 'deprecated';
  if (op?.t === 'remove') return 'missing';
  if (!row.inPo && op?.t !== 'set') return 'missing';
  const values = currentValues(row, op, nplurals);
  const filled = values.filter((v) => v !== '').length;
  if (filled === values.length) return 'translated';
  return filled === 0 ? 'empty' : 'partial';
}

export function isChanged(row, op, nplurals) {
  if (!op) return false;
  if (op.t === 'remove') return row.inPo;
  if (!row.inPot) return false;
  if (!row.inPo) return true;
  return !sameValues(currentValues(row, op, nplurals), baseValues(row, nplurals));
}

/** A draft conflicts when the file changed underneath it to something else. */
export function isConflict(row, op, nplurals) {
  if (op?.t !== 'set' || !row.inPo || !row.inPot) return false;
  const base = baseValues(row, nplurals);
  const seen = normalize(op.b ?? [], base.length);
  return !sameValues(seen, base) && !sameValues(currentValues(row, op, nplurals), base);
}

export function computeStats(rows, entries, nplurals) {
  const stats = { total: 0, translated: 0, partial: 0, empty: 0, missing: 0, deprecated: 0, changed: 0 };
  for (const row of rows) {
    const op = entries?.[row.key];
    const status = rowStatus(row, op, nplurals);
    if (row.inPot) stats.total++;
    if (status !== 'removed') stats[status]++;
    if (isChanged(row, op, nplurals)) stats.changed++;
  }
  return stats;
}

export const statsArray = (stats) => STAT_KEYS.map((k) => stats[k]);

/** Drops ops that no longer do anything (already applied upstream, entry gone, ...). */
export function pruneOps(ops, rows, nplurals) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const entries = {};
  for (const [key, op] of Object.entries(ops?.entries ?? {})) {
    const row = byKey.get(key);
    if (row && isChanged(row, op, nplurals)) entries[key] = op;
  }
  const result = { entries };
  if (ops?.reorder) result.reorder = true;
  if (ops?.plurals) result.plurals = ops.plurals;
  return result;
}

export const isEmptyOps = (ops) => !ops || (!ops.reorder && !ops.plurals && Object.keys(ops.entries ?? {}).length === 0);

/** True when a file's Plural-Forms header already means the same as `rule`. */
export const usesPluralRule = (file, rule) => sameRule(headerFields(file).get('Plural-Forms'), rule);

/**
 * Updates a parsed file to the Plural-Forms value `rule`: rewrites the header line and
 * moves the forms of every plural entry to the new rule (see formMapping). Forms the
 * new rule adds are left empty. Returns false when the file already uses the rule.
 */
export function applyPluralRule(file, rule) {
  const to = parsePluralForms(rule);
  let from = null;
  try {
    from = parsePluralForms(headerFields(file).get('Plural-Forms'));
  } catch { /* unreadable header: keep the forms by index */ }
  if (from && sameForms(from, to)) return false;
  const mapping = from ? formMapping(from, to) : Array.from({ length: to.nplurals }, (_, i) => i);
  setHeaderField(file, 'Plural-Forms', rule);
  for (const block of file.blocks) {
    if (block.kind !== 'entry' || block.idPlural === null) continue;
    const values = mapping.map((j) => (j >= 0 ? block.str[j] ?? '' : ''));
    if (!sameValues(values, block.str)) setMsgstr(file, block, values);
  }
  return true;
}

/** True when the entries shared with the template appear in template order. */
export function isOrdered(pot, po) {
  if (!pot || !po) return true;
  const position = new Map();
  let i = 0;
  for (const t of pot.blocks) if (t.kind === 'entry') position.set(blockKey(t), i++);
  let last = -1;
  for (const b of po.blocks) {
    if (b.kind !== 'entry') continue;
    const p = position.get(blockKey(b));
    if (p === undefined) continue;
    if (p < last) return false;
    last = p;
  }
  return true;
}

function reorder(file, pot) {
  if (!file.blocks.length) return;
  const lastSep = file.blocks[file.blocks.length - 1].sep;
  const firstEntry = file.blocks.findIndex((b) => b.kind === 'entry');
  if (firstEntry === -1) return;
  const head = file.blocks.slice(0, firstEntry);
  const rest = file.blocks.slice(firstEntry);
  const byKey = new Map();
  for (const b of rest) if (b.kind === 'entry' && !byKey.has(blockKey(b))) byKey.set(blockKey(b), b);
  const ordered = [];
  const placed = new Set();
  for (const t of pot.blocks) {
    if (t.kind !== 'entry') continue;
    const b = byKey.get(blockKey(t));
    if (b && !placed.has(b)) { ordered.push(b); placed.add(b); }
  }
  for (const b of rest) if (!placed.has(b)) ordered.push(b);
  file.blocks = [...head, ...ordered];
  for (const b of file.blocks) b.sep = file.eol;
  file.blocks[file.blocks.length - 1].sep = lastSep;
}

/**
 * Applies pending changes to a file.
 *   pot      parsed template, or null for a file without template
 *   poText   current file text, or null when the file does not exist
 *   defaults { pluralForms, language } for a file that has to be created
 * Returns the new text, or null when the file does not exist and nothing creates it.
 */
export function applyOps({ pot, poText, ops, defaults }) {
  const entries = ops?.entries ?? {};
  let file;
  if (poText == null) {
    if (!pot || !Object.values(entries).some((op) => op.t === 'set')) return null;
    file = createFromTemplate(pot, defaults ?? {});
  } else {
    file = parsePo(poText);
    if (ops?.plurals) applyPluralRule(file, ops.plurals);
  }
  const nplurals = pluralCount(file);
  const templates = new Map();
  if (pot) for (const t of pot.blocks) if (t.kind === 'entry' && !templates.has(blockKey(t))) templates.set(blockKey(t), t);
  const present = new Map();
  for (const b of file.blocks) if (b.kind === 'entry' && !present.has(blockKey(b))) present.set(blockKey(b), b);

  for (const [key, op] of Object.entries(entries)) {
    const block = present.get(key);
    if (!block) continue;
    if (op.t === 'remove') {
      removeBlock(file, block);
      present.delete(key);
      continue;
    }
    const template = templates.get(key);
    if (!template) continue; // deprecated entries are not editable
    const plural = template.idPlural !== null;
    const wanted = normalize(op.v, plural ? nplurals : 1);
    if (plural !== (block.idPlural !== null) || template.idPlural !== block.idPlural) adoptTemplateShape(file, block, template, wanted);
    else if (!sameValues(wanted, block.str)) setMsgstr(file, block, wanted);
  }

  if (pot) {
    let anchor = headerBlock(file);
    for (const template of pot.blocks) {
      if (template.kind !== 'entry') continue;
      const key = blockKey(template);
      const existing = present.get(key);
      if (existing) { anchor = existing; continue; }
      const op = entries[key];
      if (op?.t !== 'set') continue;
      const block = entryFromTemplate(file, template, normalize(op.v, template.idPlural !== null ? nplurals : 1));
      insertAfter(file, anchor, block);
      present.set(key, block);
      anchor = block;
    }
    if (ops?.reorder) reorder(file, pot);
  }
  return serializePo(file);
}
