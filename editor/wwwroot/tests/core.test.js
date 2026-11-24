// Tests for the PO core. They use the repository's own files as the corpus, so they
// also detect a future file the editor could not rewrite faithfully.

import { test, assert, equal, deepEqual, throws } from './harness.js';
import { parsePo, serializePo, escapePo, unescapePo, blockKey, entryKey, headerFields, pluralCount, entryBlocks } from '../js/po.js';
import { buildRows, computeStats, applyOps, isOrdered, statsArray, usesPluralRule, applyPluralRule } from '../js/catalog.js';
import { parsePluralForms, describeForms, parseRange, formatNumbers, sameRule, formMapping } from '../js/plurals.js';
import { pluralRules, pluralRuleFor } from '../js/plural-rules.js';
import { diffLines, filePatch, gitBlobSha, diffStat, textHunks } from '../js/diff.js';
import { createZip } from '../js/zip.js';
import { splitLines } from '../js/po.js';

const potPath = (name) => `Localization/${name}.pot`;
const poPath = (culture, name) => `Localization/${culture}/${name}.po`;

const pots = new Map();
async function pot(env, name) {
  if (!pots.has(name)) {
    const text = env.templates.includes(name) ? await env.read(potPath(name)) : null;
    pots.set(name, text == null ? null : parsePo(text));
  }
  return pots.get(name);
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const lines = (text) => splitLines(text).map((l) => l.text + l.eol);
const changes = (oldText, newText) => {
  const ops = diffLines(lines(oldText), lines(newText));
  return { added: ops.filter(([t]) => t === '+').map(([, l]) => l), removed: ops.filter(([t]) => t === '-').map(([, l]) => l) };
};

function stats(potFile, text) {
  const po = text == null ? null : parsePo(text);
  return computeStats(buildRows(potFile, po), {}, po ? pluralCount(po) : 2);
}

/** First file of a culture (in template order) whose stats satisfy the predicate. */
async function findFile(env, culture, predicate) {
  for (const name of env.templates) {
    if (!env.cultures[culture]?.includes(name)) continue;
    const text = await env.read(poPath(culture, name));
    const template = await pot(env, name);
    if (predicate(stats(template, text), template, parsePo(text))) return { name, text, template };
  }
  return null;
}

const patches = [];

test('escape and unescape are inverse', () => {
  for (const s of ['plain', 'a "quoted" b', 'back\\slash', 'line\nbreak', 'tab\there', '\\n literal', '', 'mixed \\"\n\t\\']) {
    equal(unescapePo(escapePo(s)), s);
  }
  equal(unescapePo('Line\\n\\"quoted\\"\\\\tail\\t'), 'Line\n"quoted"\\tail\t');
  equal(escapePo('Line\n"quoted"\\tail\t'), 'Line\\n\\"quoted\\"\\\\tail\\t');
});

test('parser reads comments, context, plurals and continuation lines', () => {
  const text = '#\nmsgid ""\nmsgstr ""\n"Language: fr\\n"\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n\n'
    + '#. note\n#: A.cs\n#, csharp-format, range: 0..9\nmsgctxt "C"\nmsgid "one"\nmsgid_plural "many"\nmsgstr[0] "un"\nmsgstr[1] ""\n"plusieurs"\n';
  const file = parsePo(text);
  equal(serializePo(file), text);
  equal(file.blocks.length, 2);
  equal(file.blocks[0].kind, 'header');
  equal(headerFields(file).get('Language'), 'fr');
  equal(pluralCount(file), 2);
  const entry = file.blocks[1];
  deepEqual([entry.ctxt, entry.id, entry.idPlural, entry.str], ['C', 'one', 'many', ['un', 'plusieurs']]);
  deepEqual([entry.extracted, entry.refs, entry.flags], [['note'], ['A.cs'], ['csharp-format', 'range: 0..9']]);
  deepEqual(parseRange(entry.flags), { from: 0, to: 9 });
});

test('corpus: every .pot and .po round-trips byte for byte', async (env) => {
  const files = env.templates.map(potPath);
  for (const [culture, names] of Object.entries(env.cultures)) for (const name of names) files.push(poPath(culture, name));
  let entries = 0;
  const problems = [];
  await pool(files, 24, async (path) => {
    const text = await env.read(path);
    if (text == null) { problems.push(`${path}: cannot be read`); return; }
    const file = parsePo(text);
    if (serializePo(file) !== text) problems.push(`${path}: does not round-trip`);
    for (const block of file.blocks) {
      if (block.kind === 'other') problems.push(`${path}: unrecognized block starting "${block.lines[0]?.text}"`);
      if (block.kind === 'entry') entries++;
    }
    if (path.endsWith('.po')) {
      const forms = headerFields(file).get('Plural-Forms');
      let n = null;
      try { n = parsePluralForms(forms).nplurals; } catch (e) { problems.push(`${path}: ${e.message}`); }
      for (const block of file.blocks) {
        if (block.kind === 'entry' && block.idPlural !== null && n !== null && block.str.length !== n) {
          problems.push(`${path}: "${block.id}" has ${block.str.length} forms, header says ${n}`);
        }
      }
    }
  });
  assert(problems.length === 0, `${problems.length} problem(s):\n  ${problems.slice(0, 10).join('\n  ')}`);
  return `${files.length} files, ${entries} entries`;
});

test('corpus: statistics match data/index.json', async (env) => {
  if (!env.index) return 'skipped (no index)';
  const templateCounts = Object.fromEntries(env.index.templates.map((t) => [t.name, t.entries]));
  const mismatches = [];
  let compared = 0;
  for (const culture of env.index.cultures) {
    const names = Object.keys(culture.files);
    deepEqual(names.slice().sort(), (env.cultures[culture.code] ?? []).slice().sort(), `file list of ${culture.code}`);
    await pool(names, 24, async (name) => {
      const template = await pot(env, name);
      const text = await env.read(poPath(culture.code, name));
      const mine = JSON.stringify(statsArray(stats(template, text)));
      const theirs = JSON.stringify(culture.files[name]);
      if (mine !== theirs) mismatches.push(`${culture.code}/${name}: editor ${mine}, index ${theirs}`);
      compared++;
    });
  }
  for (const name of env.templates) {
    const template = await pot(env, name);
    equal(templateCounts[name], entryBlocks(template).length, `entry count of ${name}`);
  }
  assert(mismatches.length === 0, `${mismatches.length} mismatch(es):\n  ${mismatches.slice(0, 10).join('\n  ')}`);
  return `${compared} files compared`;
});

test('editing a translation only changes its msgstr line', async (env) => {
  const path = poPath('ar', 'OrchardCore.Admin');
  const text = await env.read(path);
  const template = await pot(env, 'OrchardCore.Admin');
  const key = entryKey('OrchardCore.Admin.AdminMenu', 'Admin');
  const next = applyOps({ pot: template, poText: text, ops: { entries: { [key]: { t: 'set', v: ['He said "hi"\nbye'], b: null } } } });
  const { added, removed } = changes(text, next);
  equal(removed.length, 1);
  deepEqual(added, ['msgstr "He said \\"hi\\"\\nbye"\n']);
  equal(parsePo(next).blocks.find((b) => blockKey(b) === key).str[0], 'He said "hi"\nbye');
  equal(applyOps({ pot: template, poText: text, ops: { entries: {} } }), text, 'no ops means no change');
  patches.push(await filePatch(path, text, next));
});

test('editing one plural form rewrites one of the six Arabic lines', async (env) => {
  const path = poPath('ar', 'OrchardCore.Admin');
  const text = await env.read(path);
  const template = await pot(env, 'OrchardCore.Admin');
  const key = entryKey('OrchardCore.Admin.Views.AdminListToolbar', ' / {0} item in total');
  const before = parsePo(text).blocks.find((b) => blockKey(b) === key);
  equal(before.str.length, 6);
  const values = before.str.slice();
  values[2] = 'عنصران';
  const next = applyOps({ pot: template, poText: text, ops: { entries: { [key]: { t: 'set', v: values, b: before.str } } } });
  const { added, removed } = changes(text, next);
  equal(removed.length, 1);
  deepEqual(added, ['msgstr[2] "عنصران"\n']);
  // A short value array is padded to nplurals.
  const padded = applyOps({ pot: template, poText: text, ops: { entries: { [key]: { t: 'set', v: ['x'], b: null } } } });
  equal(parsePo(padded).blocks.find((b) => blockKey(b) === key).str.length, 6);
});

test('missing entries are inserted at their template position', async (env) => {
  const found = await findFile(env, 'de', (s, t, po) => s.missing > 0 && isOrdered(t, po));
  if (!found) return 'skipped (no file with missing entries)';
  const { name, text, template } = found;
  const rows = buildRows(template, parsePo(text));
  const missing = rows.filter((r) => !r.inPo);
  const entries = {};
  missing.forEach((r, i) => { entries[r.key] = { t: 'set', v: i === 0 ? ['Übersetzung'] : [], b: null, add: true }; });
  const next = applyOps({ pot: template, poText: text, ops: { entries } });
  const after = parsePo(next);
  equal(serializePo(after), next);
  equal(stats(template, next).missing, 0);
  assert(isOrdered(template, after), 'file is still in template order');
  const templateKeys = entryBlocks(template).map(blockKey);
  const resultKeys = entryBlocks(after).map(blockKey).filter((k) => templateKeys.includes(k));
  deepEqual(resultKeys, templateKeys, 'entries follow the template exactly');
  equal(changes(text, next).removed.length, 0, 'nothing existing is rewritten');
  equal(next.endsWith('\n\n'), text.endsWith('\n\n'), 'end of file is kept');
  const first = after.blocks.find((b) => blockKey(b) === missing[0].key);
  equal(first.str[0], first.idPlural === null ? 'Übersetzung' : first.str[0]);
  patches.push(await filePatch(poPath('de', name), text, next));
  return `${name}: ${missing.length} inserted`;
});

test('removing deprecated entries only deletes lines', async (env) => {
  const found = await findFile(env, 'de', (s) => s.deprecated > 0 && s.translated > 0);
  if (!found) return 'skipped (no file with deprecated entries)';
  const { name, text, template } = found;
  const rows = buildRows(template, parsePo(text));
  const entries = {};
  for (const r of rows) if (!r.inPot) entries[r.key] = { t: 'remove' };
  const next = applyOps({ pot: template, poText: text, ops: { entries } });
  equal(serializePo(parsePo(next)), next);
  equal(stats(template, next).deprecated, 0);
  equal(changes(text, next).added.length, 0);
  equal(next.endsWith('\n\n'), text.endsWith('\n\n'));
  assert(!next.includes('\n\n\n'), 'no double blank line');
  patches.push(await filePatch(poPath('de', name), text, next));
  return `${name}: ${Object.keys(entries).length} removed`;
});

test('emptying a file without template leaves its header', async (env) => {
  let target = null;
  for (const [culture, names] of Object.entries(env.cultures)) {
    for (const name of names) {
      if (env.templates.includes(name)) continue;
      const text = await env.read(poPath(culture, name));
      if (entryBlocks(parsePo(text)).length > 0) { target = { culture, name, text }; break; }
    }
    if (target) break;
  }
  if (!target) return 'skipped (no such file)';
  const original = parsePo(target.text);
  const entries = {};
  for (const r of buildRows(null, original)) entries[r.key] = { t: 'remove' };
  const next = applyOps({ pot: null, poText: target.text, ops: { entries } });
  const after = parsePo(next);
  equal(after.blocks.length, 1);
  equal(after.blocks[0].kind, 'header');
  const header = original.blocks[0];
  equal(next, header.lines.map((l) => l.text + l.eol).join('') + original.blocks[original.blocks.length - 1].sep);
  return `${target.culture}/${target.name}`;
});

test('mixed CRLF/LF files keep every other line ending', async (env) => {
  const culture = 'sh-HR';
  for (const name of env.cultures[culture] ?? []) {
    const text = await env.read(poPath(culture, name));
    if (!text.includes('\r\n')) continue;
    const template = await pot(env, name);
    const po = parsePo(text);
    const row = buildRows(template, po).find((r) => r.inPot && r.inPo && r.idPlural === null);
    if (!row) continue;
    const next = applyOps({ pot: template, poText: text, ops: { entries: { [row.key]: { t: 'set', v: ['prijevod'], b: null } } } });
    const { added, removed } = changes(text, next);
    equal(removed.length, 1);
    equal(added.length, 1);
    equal(next.split('\r\n').length, text.split('\r\n').length, 'CRLF count');
    return `${culture}/${name}`;
  }
  return 'skipped (no CRLF file)';
});

test('polib-written files keep their leading "#" and single trailing newline', async (env) => {
  const path = poPath('fr', 'OrchardCore.Admin');
  const text = await env.read(path);
  if (!text.startsWith('#\n')) return 'skipped (file is no longer polib-shaped)';
  const template = await pot(env, 'OrchardCore.Admin');
  const key = entryKey('OrchardCore.Admin.AdminMenu', 'Admin');
  const next = applyOps({ pot: template, poText: text, ops: { entries: { [key]: { t: 'set', v: ['Administration'], b: null } } } });
  assert(next.startsWith('#\nmsgid ""\n'));
  assert(next.endsWith('"\n') && !next.endsWith('\n\n'));
  equal(changes(text, next).added.length, 1);
});

test('reordering matches the template and loses nothing', async (env) => {
  const found = await findFile(env, 'fr', (s, t, po) => !isOrdered(t, po));
  if (!found) return 'skipped (every file is ordered)';
  const { name, text, template } = found;
  const next = applyOps({ pot: template, poText: text, ops: { entries: {}, reorder: true } });
  const after = parsePo(next);
  assert(isOrdered(template, after));
  deepEqual(lines(next).filter((l) => l.trim()).sort(), lines(text).filter((l) => l.trim()).sort(), 'same lines');
  equal(next.length, text.length);
  equal(next.endsWith('\n\n'), text.endsWith('\n\n'));
  patches.push(await filePatch(poPath('fr', name), text, next));
  return name;
});

test('a missing file is created from its template', async (env) => {
  const name = env.templates.find((t) => !env.cultures.de?.includes(t));
  if (!name) return 'skipped (de has every file)';
  const template = await pot(env, name);
  const row = buildRows(template, null)[0];
  const defaults = { pluralForms: 'nplurals=2; plural=(n != 1);', language: 'de_DE' };
  equal(applyOps({ pot: template, poText: null, ops: { entries: {} }, defaults }), null);
  const next = applyOps({ pot: template, poText: null, ops: { entries: { [row.key]: { t: 'set', v: ['Wert'], b: null } } }, defaults });
  const file = parsePo(next);
  equal(serializePo(file), next);
  equal(headerFields(file).get('Plural-Forms'), defaults.pluralForms);
  equal(headerFields(file).get('Language'), 'de_DE');
  equal(entryBlocks(file).length, 1);
  assert(next.endsWith('\n') && !next.endsWith('\n\n'));
  patches.push(await filePatch(poPath('de', name), null, next));
  return name;
});

test('plural rules are evaluated without eval', async (env) => {
  const fr = parsePluralForms('nplurals=2; plural=(n > 1);');
  deepEqual([0, 1, 2, 5].map(fr.select), [0, 0, 1, 1]);
  deepEqual(describeForms(fr), ['n = 0, 1', 'n = 2–200']);
  const ar = parsePluralForms('nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 && n%100<=99 ? 4 : 5);');
  deepEqual([0, 1, 2, 3, 10, 11, 99, 100, 102, 103].map(ar.select), [0, 1, 2, 3, 3, 4, 4, 5, 5, 3]);
  equal(describeForms(ar, { from: 0, to: 23 })[5], 'not used for 0..23');
  const pl = parsePluralForms('nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);');
  deepEqual([1, 2, 4, 5, 12, 22, 25].map(pl.select), [0, 1, 1, 2, 2, 1, 2]);
  equal(formatNumbers([0, 2, 3, 4, 7, 8]), '0, 2–4, 7, 8');
  for (const bad of ['nplurals=2; plural=n +;', 'nplurals=0; plural=0;', 'nplurals=2; plural=alert(1);', 'plural=n', '', 'nplurals=2; plural=' + '('.repeat(80) + 'n' + ')'.repeat(80) + ';']) {
    throws(() => parsePluralForms(bad), `should reject ${JSON.stringify(bad.slice(0, 40))}`);
  }
  // Every rule used in the repository: each number selects a valid form.
  const seen = new Set();
  for (const [culture, names] of Object.entries(env.cultures)) {
    if (!names.length) continue;
    const forms = headerFields(parsePo(await env.read(poPath(culture, names[0])))).get('Plural-Forms');
    seen.add(forms);
    const rule = parsePluralForms(forms);
    for (let n = 0; n <= 1000; n++) assert(rule.select(n) >= 0, `${culture}: n=${n} selects no form`);
  }
  return `${seen.size} distinct rules in the repository`;
});

test('plural rule database follows CLDR with Orchard Core form indexes', async (env) => {
  for (const [code, rule] of pluralRules()) {
    const forms = parsePluralForms(rule);
    const used = new Set();
    for (let n = 0; n <= 3000; n++) used.add(forms.select(n));
    for (const n of [100000, 1000000, 2000000, 1100000]) used.add(forms.select(n));
    assert(!used.has(-1), `${code}: a number selects no form`);
    equal(used.size, forms.nplurals, `${code}: every form is used`);
  }
  const select = (code, numbers) => numbers.map(parsePluralForms(pluralRuleFor(code)).select);
  deepEqual(select('fr', [0, 1, 2, 1000000, 2000000, 1000001]), [0, 0, 1, 2, 2, 1]);
  deepEqual(select('es', [0, 1, 2, 1000000]), [1, 0, 1, 2]);
  deepEqual(select('he', [1, 2, 3]), [0, 2, 1]);
  deepEqual(select('sl', [1, 2, 3, 5, 101]), [1, 2, 3, 0, 1]);
  deepEqual(select('vi', [0, 1, 2]), [0, 0, 1]);
  equal(pluralRuleFor('sr-cyrl-RS'), pluralRuleFor('sr'));
  equal(pluralRuleFor('zh_Hans'), 'nplurals=1; plural=0;');
  equal(pluralRuleFor('pt-BR'), pluralRuleFor('pt'));
  assert(pluralRuleFor('pt-PT') !== pluralRuleFor('pt'), 'pt-PT has its own rule');
  equal(pluralRuleFor('xx'), null);
  // Rules written differently but meaning the same are not reported as outdated.
  assert(sameRule('nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 && n%100<=99 ? 4 : 5);', pluralRuleFor('ar')));
  assert(!sameRule('nplurals=2; plural=(n > 1);', pluralRuleFor('fr')));
  const outdated = [];
  for (const [culture, names] of Object.entries(env.cultures)) {
    const rule = pluralRuleFor(culture);
    if (!names.length || !rule) continue;
    if (!usesPluralRule(parsePo(await env.read(poPath(culture, names[0]))), rule)) outdated.push(culture);
  }
  return `outdated in the repository: ${outdated.join(', ') || 'none'}`;
});

test('form mapping keeps translations and leaves added forms empty', () => {
  const map = (from, to) => formMapping(parsePluralForms(from), parsePluralForms(to));
  deepEqual(map('nplurals=2; plural=(n > 1);', pluralRuleFor('fr')), [0, 1, -1], 'fr: "many" is new');
  deepEqual(map('nplurals=4; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 3;', pluralRuleFor('cs')), [0, 1, 3], 'cs: unused form dropped');
  deepEqual(map('nplurals=4; plural=n%100==1 ? 0 : n%100==2 ? 1 : n%100==3 || n%100==4 ? 2 : 3;', pluralRuleFor('sl')), [3, 0, 1, 2], 'sl: forms reordered');
  deepEqual(map('nplurals=3; plural=(n==1 ? 0 : n==2 ? 1 : 2);', pluralRuleFor('he')), [0, 2, 1], 'he: "two" moved last');
  deepEqual(map('nplurals=1; plural=0;', pluralRuleFor('vi')), [0, -1], 'vi: "other" is new');
  deepEqual(map(pluralRuleFor('ru'), pluralRuleFor('ru')), [0, 1, 2]);
});

test('updating the plural rule of a file only touches its plural lines', async (env) => {
  const name = 'OrchardCore.Admin';
  const path = poPath('fr', name);
  const text = await env.read(path);
  const template = await pot(env, name);
  const before = parsePo(text);
  if (usesPluralRule(before, pluralRuleFor('fr'))) return 'skipped (already updated)';
  const plurals = entryBlocks(before).filter((b) => b.idPlural !== null);
  assert(plurals.length > 0, 'the file has plural entries');
  const next = applyOps({ pot: template, poText: text, ops: { entries: {}, plurals: pluralRuleFor('fr') } });
  const after = parsePo(next);
  equal(serializePo(after), next);
  equal(headerFields(after).get('Plural-Forms'), pluralRuleFor('fr'));
  equal(pluralCount(after), 3);
  for (const block of plurals) {
    const updated = after.blocks.find((b) => blockKey(b) === blockKey(block));
    deepEqual(updated.str, [block.str[0], block.str[1], ''], `forms of "${block.id}"`);
  }
  const { added, removed } = changes(text, next);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  deepEqual(removed, [`"Plural-Forms: nplurals=2; plural=(n > 1);\\n"${eol}`]);
  equal(added.length, 1 + plurals.length);
  deepEqual(added.slice(1), plurals.map(() => `msgstr[2] ""${eol}`));
  equal(applyOps({ pot: template, poText: next, ops: { entries: {}, plurals: pluralRuleFor('fr') } }), next, 'updating twice changes nothing');
  // An edit queued with the update is applied to the new forms.
  const key = blockKey(plurals[0]);
  const edited = applyOps({ pot: template, poText: text, ops: { entries: { [key]: { t: 'set', v: ['a', 'b', 'c'], b: null } }, plurals: pluralRuleFor('fr') } });
  deepEqual(parsePo(edited).blocks.find((b) => blockKey(b) === key).str, ['a', 'b', 'c']);
  patches.push(await filePatch(path, text, next));
  return `${plurals.length} plural entries`;
});

test('a header without Plural-Forms gets one', () => {
  const text = 'msgid ""\nmsgstr ""\n"Language: vi\\n"\n\nmsgid "file"\nmsgid_plural "files"\nmsgstr[0] "tệp"\n';
  const file = parsePo(text);
  assert(applyPluralRule(file, pluralRuleFor('vi')));
  equal(serializePo(file), 'msgid ""\nmsgstr ""\n"Language: vi\\n"\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n\nmsgid "file"\nmsgid_plural "files"\nmsgstr[0] "tệp"\nmsgstr[1] ""\n');
});

test('unified diff and git blob ids', async () => {
  equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  const a = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n';
  const b = 'one\ntwo\nthree\nfour\nFIVE\nsix\nseven\neight\nnine\nten\n';
  deepEqual(diffStat(a, b), { added: 2, removed: 1 });
  const patch = await filePatch('x.txt', a, b);
  assert(patch.includes('@@ -2,8 +2,9 @@\n two\n three\n four\n-five\n+FIVE\n six\n seven\n eight\n nine\n+ten\n'), patch);
  equal(textHunks('a\nb\n', 'a\nb').length, 1);
  assert((await filePatch('n.txt', null, 'x\n')).includes('--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+x\n'));
  equal(await filePatch('same.txt', 'x\n', 'x\n'), '');
});

test('generated patches apply with git', async (env) => {
  if (!env.gitApplyCheck) return 'skipped (browser)';
  assert(patches.length >= 3, 'earlier tests produced patches');
  for (const patch of patches) {
    const error = await env.gitApplyCheck(patch);
    assert(error === null, `git apply --check failed for ${patch.split('\n')[0]}:\n${error}`);
  }
  const all = await env.gitApplyCheck(patches.filter((p, i, list) => list.findIndex((q) => q.split('\n')[0] === p.split('\n')[0]) === i).join(''));
  assert(all === null, `combined patch failed:\n${all}`);
  return `${patches.length} patches`;
});

test('zip archive structure', () => {
  const zip = createZip([{ path: 'Localization/fr/A.po', text: 'hello' }, { path: 'b.txt', text: '' }]);
  const view = new DataView(zip.buffer);
  equal(view.getUint32(0, true), 0x04034b50);
  equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  equal(view.getUint16(zip.length - 12, true), 2);
  equal(view.getUint32(14, true), 0x3610a686, 'CRC-32 of "hello"');
});
