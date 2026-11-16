// Lossless gettext PO reader/writer.
//
// The repository's .po files were written by three different tools that disagree on
// header order, end-of-file bytes and even line endings. To keep pull requests
// reviewable, this module never canonicalizes: a parsed file is a list of blocks that
// keep their raw lines, and only the lines of an edited entry are regenerated.

const KEYWORD = /^(msgctxt|msgid_plural|msgid|msgstr)(?:\[(\d+)\])?[ \t]*"(.*)"[ \t]*$/;
const CONTINUATION = /^[ \t]*"(.*)"[ \t]*$/;

/** Splits text into lines, remembering each line's own terminator. */
export function splitLines(text) {
  const lines = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) {
      lines.push({ text: text.slice(pos), eol: '' });
      break;
    }
    const crlf = nl > pos && text.charCodeAt(nl - 1) === 13;
    lines.push({ text: text.slice(pos, crlf ? nl - 1 : nl), eol: crlf ? '\r\n' : '\n' });
    pos = nl + 1;
  }
  return lines;
}

const isBlank = (line) => line.text.trim() === '';
const rawLine = (line) => line.text + line.eol;

export function unescapePo(s) {
  if (!s.includes('\\')) return s;
  return s.replace(/\\(.)/g, (match, c) => {
    switch (c) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      default: return match;
    }
  });
}

export function escapePo(s) {
  return s.replace(/[\\"\n\t\r]/g, (c) => {
    switch (c) {
      case '\n': return '\\n';
      case '\t': return '\\t';
      case '\r': return '\\r';
      default: return '\\' + c;
    }
  });
}

/** Entries are identified by context + source text, as in the repository tooling. */
export const entryKey = (ctxt, id) => (ctxt ?? '') + '\u0004' + id;
export const blockKey = (block) => entryKey(block.ctxt, block.id);

/** (Re)computes the parsed fields of a block from its raw lines. */
export function analyze(block) {
  const fields = { ctxt: null, id: null, idPlural: null };
  const str = [];
  const strRanges = [];
  const extracted = [];
  const refs = [];
  const flags = [];
  let current = null;
  let kwFrom = -1;
  let strFrom = -1;
  let strTo = -1;
  let wellFormed = true;

  block.lines.forEach((line, index) => {
    const text = line.text;
    if (text.startsWith('#')) {
      current = null;
      if (text.startsWith('#.')) extracted.push(text.slice(2).trim());
      else if (text.startsWith('#:')) refs.push(text.slice(2).trim());
      else if (text.startsWith('#,')) flags.push(...text.slice(2).split(',').map((f) => f.trim()).filter(Boolean));
      return;
    }
    let m = KEYWORD.exec(text);
    if (m) {
      if (kwFrom === -1) kwFrom = index;
      const value = unescapePo(m[3]);
      if (m[1] === 'msgstr') {
        const slot = m[2] === undefined ? 0 : Number(m[2]);
        str[slot] = value;
        strRanges[slot] = [index, index + 1];
        if (strFrom === -1) strFrom = index;
        strTo = index + 1;
        current = { str: slot };
      } else {
        const name = m[1] === 'msgctxt' ? 'ctxt' : m[1] === 'msgid' ? 'id' : 'idPlural';
        fields[name] = value;
        current = { field: name };
      }
      return;
    }
    m = CONTINUATION.exec(text);
    if (m && current) {
      const value = unescapePo(m[1]);
      if ('str' in current) {
        str[current.str] += value;
        strRanges[current.str][1] = index + 1;
        strTo = index + 1;
      } else {
        fields[current.field] += value;
      }
      return;
    }
    wellFormed = false;
  });

  for (let i = 0; i < str.length; i++) if (str[i] === undefined) wellFormed = false;

  Object.assign(block, fields, { str, strRanges, extracted, refs, flags, kwFrom, strFrom, strTo });
  if (!wellFormed || fields.id === null || str.length === 0) block.kind = 'other';
  else if (fields.id === '' && fields.ctxt === null) block.kind = 'header';
  else block.kind = 'entry';
  return block;
}

export function parsePo(text) {
  const lines = splitLines(text);
  const blocks = [];
  let i = 0;
  let lead = '';
  while (i < lines.length && isBlank(lines[i])) lead += rawLine(lines[i++]);
  while (i < lines.length) {
    const blockLines = [];
    while (i < lines.length && !isBlank(lines[i])) blockLines.push(lines[i++]);
    let sep = '';
    while (i < lines.length && isBlank(lines[i])) sep += rawLine(lines[i++]);
    blocks.push(analyze({ lines: blockLines, sep }));
  }
  // Only the first header-shaped block is the header.
  let seenHeader = false;
  for (const block of blocks) {
    if (block.kind !== 'header') continue;
    if (seenHeader) block.kind = 'entry';
    seenHeader = true;
  }
  const header = blocks.find((b) => b.kind === 'header');
  const eol = (header ?? blocks[0])?.lines.find((l) => l.eol)?.eol ?? '\n';
  return { lead, blocks, eol };
}

export function serializePo(file) {
  let out = file.lead;
  for (const block of file.blocks) {
    for (const line of block.lines) out += line.text + line.eol;
    out += block.sep;
  }
  return out;
}

export const headerBlock = (file) => file.blocks.find((b) => b.kind === 'header') ?? null;
export const entryBlocks = (file) => file.blocks.filter((b) => b.kind === 'entry');

/** Header fields ("Name: value") in file order. */
export function headerFields(file) {
  const fields = new Map();
  const header = headerBlock(file);
  if (!header) return fields;
  for (const line of header.str[0].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return fields;
}

/** Number of plural forms the file is written with. */
export function pluralCount(file) {
  const forms = headerFields(file).get('Plural-Forms');
  const m = forms && /nplurals\s*=\s*(\d+)/.exec(forms);
  if (m && Number(m[1]) >= 1) return Number(m[1]);
  let max = 0;
  for (const b of file.blocks) if (b.kind === 'entry' && b.idPlural !== null) max = Math.max(max, b.str.length);
  return max || 2;
}

function msgstrLines(values, plural, eol) {
  return values.map((value, i) => ({
    text: plural ? `msgstr[${i}] "${escapePo(value)}"` : `msgstr "${escapePo(value)}"`,
    eol,
  }));
}

/**
 * Replaces the translation of an entry. Lines of forms whose value did not change are
 * reused as they are; everything outside the msgstr lines is untouched.
 */
export function setMsgstr(file, block, values) {
  const plural = block.idPlural !== null;
  const wanted = plural ? values : [values[0] ?? ''];
  const old = block.lines.slice(block.strFrom, block.strTo);
  const lastEol = old.length ? old[old.length - 1].eol : file.eol;
  const eol = old.find((l) => l.eol)?.eol ?? file.eol;
  const replacement = [];
  wanted.forEach((value, i) => {
    const range = block.strRanges[i];
    if (range && block.str[i] === value) {
      for (const line of block.lines.slice(range[0], range[1])) replacement.push({ text: line.text, eol: line.eol || eol });
    } else {
      replacement.push({ text: plural ? `msgstr[${i}] "${escapePo(value)}"` : `msgstr "${escapePo(value)}"`, eol });
    }
  });
  if (replacement.length) replacement[replacement.length - 1].eol = lastEol;
  block.lines.splice(block.strFrom, block.strTo - block.strFrom, ...replacement);
  return analyze(block);
}

/**
 * Makes an entry follow the template's singular/plural shape: the msgctxt, msgid and
 * msgid_plural lines are taken from the template, comments are kept.
 */
export function adoptTemplateShape(file, block, template, values) {
  const plural = template.idPlural !== null;
  const lastEol = block.lines[block.lines.length - 1].eol;
  const keywords = template.lines.slice(template.kwFrom, template.strFrom).map((l) => ({ text: l.text, eol: file.eol }));
  const lines = [...block.lines.slice(0, block.kwFrom), ...keywords, ...msgstrLines(values, plural, file.eol)];
  lines[lines.length - 1].eol = lastEol;
  block.lines = lines;
  return analyze(block);
}

/** Builds a new entry for `file` from a template entry: template lines verbatim, new msgstr lines. */
export function entryFromTemplate(file, template, values) {
  const plural = template.idPlural !== null;
  const lines = template.lines.slice(0, template.strFrom).map((l) => ({ text: l.text, eol: file.eol }));
  lines.push(...msgstrLines(plural ? values : [values[0] ?? ''], plural, file.eol));
  return analyze({ lines, sep: '' });
}

/** Inserts `block` after `anchor` (or first when anchor is null), keeping the file's ending. */
export function insertAfter(file, anchor, block) {
  const index = anchor ? file.blocks.indexOf(anchor) : -1;
  if (index === -1) {
    block.sep = file.blocks.length ? file.eol : '';
    file.blocks.unshift(block);
    return;
  }
  block.sep = anchor.sep;
  anchor.sep = file.eol;
  file.blocks.splice(index + 1, 0, block);
}

export function removeBlock(file, block) {
  const index = file.blocks.indexOf(block);
  if (index === -1) return;
  if (index === file.blocks.length - 1 && index > 0) file.blocks[index - 1].sep = block.sep;
  file.blocks.splice(index, 1);
}

/**
 * Creates the header of a new .po file from its template, adding the culture's
 * plural rule and language (taken from a sibling file of the same culture).
 */
export function createFromTemplate(template, { pluralForms, language }) {
  const source = headerBlock(template);
  const lines = source
    ? source.lines.map((l) => ({ text: l.text, eol: '\n' }))
    : [{ text: 'msgid ""', eol: '\n' }, { text: 'msgstr ""', eol: '\n' }];
  const existing = source ? headerFields(template) : new Map();
  if (pluralForms && !existing.has('Plural-Forms')) lines.push({ text: `"${escapePo(`Plural-Forms: ${pluralForms}\n`)}"`, eol: '\n' });
  if (language && !existing.has('Language')) lines.push({ text: `"${escapePo(`Language: ${language}\n`)}"`, eol: '\n' });
  const header = analyze({ lines, sep: '' });
  return { lead: '', blocks: [header], eol: '\n' };
}
